import { Command } from "commander";
import * as path from "path";
import pc from "picocolors";
import { createSpinner } from "nanospinner";
import { loadConfig } from "../lib/config";
import { FlyClient, FlyApiError } from "../lib/fly-client";
import {
  parseComposeFile,
  generateAppName,
  toFlyMachineConfig,
  ComposeService,
} from "../lib/compose";
import { buildAndPush, checkDockerAvailable } from "../lib/docker";
import { saveEnv, findEnv, findEnvByBranch, EnvRecord } from "../lib/env-store";
import { getBranchName, getRepoName } from "../lib/git";

export const upCommand = new Command("up")
  .description("Provision environment from docker-compose.yml")
  .option("-f, --file <path>", "Path to docker-compose.yml", "docker-compose.yml")
  .option("--region <region>", "Fly.io region", "iad")
  .option("--name <name>", "Override environment name")
  .action(async (options: { file: string; region: string; name?: string }) => {
    const config = loadConfig();
    const client = new FlyClient({ token: config.flyApiToken });

    // Parse compose file
    const composePath = path.resolve(options.file);
    let parsed;
    try {
      parsed = parseComposeFile(composePath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`Failed to parse ${options.file}: ${msg}`));
      process.exit(1);
    }

    // Determine app name
    const appName = options.name
      ? generateAppName(options.name, "")
      : generateAppName(getRepoName(), getBranchName());

    // Check for existing environment
    const existing = findEnv(appName) || findEnvByBranch(getBranchName());
    if (existing) {
      console.error(
        pc.yellow(
          `Environment "${existing.appName}" already exists for branch "${existing.branch}".`
        )
      );
      console.error(pc.yellow(`Run ${pc.bold(`cloudenv down ${existing.appName}`)} first.`));
      process.exit(1);
    }

    // Check if any services need docker build
    const needsBuild = parsed.services.some((s) => s.build && !s.image);
    if (needsBuild && !checkDockerAvailable()) {
      console.error(
        pc.red(
          "Docker is required to build services with 'build:' in docker-compose.yml. Please install Docker."
        )
      );
      process.exit(1);
    }

    // Create Fly app
    let createdAppName = appName;
    const appSpinner = createSpinner(`Creating Fly app ${pc.bold(appName)}...`).start();
    try {
      await client.createApp(appName, config.orgSlug);
    } catch (err) {
      if (err instanceof FlyApiError && err.status === 422) {
        // Name collision, retry with random suffix
        const suffix = Math.random().toString(36).substring(2, 6);
        createdAppName = `${appName.substring(0, 25)}-${suffix}`;
        try {
          await client.createApp(createdAppName, config.orgSlug);
        } catch (retryErr) {
          appSpinner.error({ text: `Failed to create Fly app` });
          console.error(
            pc.red(retryErr instanceof Error ? retryErr.message : String(retryErr))
          );
          process.exit(1);
        }
      } else {
        appSpinner.error({ text: `Failed to create Fly app` });
        console.error(pc.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    }
    appSpinner.success({ text: `Created Fly app ${pc.bold(createdAppName)}` });

    // Track created machines for cleanup on failure
    const createdMachineIds: string[] = [];

    try {
      // Build images for services with build: context
      for (const service of parsed.services) {
        if (service.build && !service.image) {
          const buildSpinner = createSpinner(
            `Building image for ${pc.bold(service.name)}...`
          ).start();
          try {
            const result = buildAndPush(
              service.name,
              service.build.context,
              service.build.dockerfile,
              createdAppName,
              config.flyApiToken
            );
            service.image = result.imageRef;
            buildSpinner.success({
              text: `Built image for ${pc.bold(service.name)}`,
            });
          } catch (err) {
            buildSpinner.error({
              text: `Failed to build ${service.name}`,
            });
            throw err;
          }
        }
      }

      // Order services: web first, then by depends_on
      const orderedServices = orderServices(parsed.services, parsed.webService);

      // Create machines
      const envServices: EnvRecord["services"] = [];

      for (const service of orderedServices) {
        const isWeb = parsed.webService?.name === service.name;
        const machineSpinner = createSpinner(
          `Starting ${pc.bold(service.name)}${isWeb ? " (web)" : ""}...`
        ).start();

        const machineConfig = toFlyMachineConfig(
          service,
          createdAppName,
          isWeb,
          options.region
        );

        try {
          const machine = await client.createMachine(createdAppName, machineConfig);
          createdMachineIds.push(machine.id);

          await client.waitForMachine(createdAppName, machine.id, "started", 60);

          envServices.push({
            name: service.name,
            machineId: machine.id,
            image: service.image || "",
            privateIp: machine.private_ip,
            isWeb,
          });

          machineSpinner.success({
            text: `Started ${pc.bold(service.name)}${isWeb ? " (web)" : ""} — ${machine.private_ip}`,
          });
        } catch (err) {
          machineSpinner.error({ text: `Failed to start ${service.name}` });
          throw err;
        }
      }

      // Save environment
      const url = `https://${createdAppName}.fly.dev`;
      const envRecord: EnvRecord = {
        appName: createdAppName,
        repo: getRepoName(),
        branch: getBranchName(),
        url,
        services: envServices,
        createdAt: new Date().toISOString(),
      };
      saveEnv(envRecord);

      // Print summary
      console.log("");
      console.log(pc.green(pc.bold("Environment ready!")));
      console.log("");
      console.log(`  URL: ${pc.cyan(pc.bold(url))}`);
      console.log("");
      console.log("  Services:");
      for (const svc of envServices) {
        if (svc.isWeb) {
          console.log(`    ${pc.bold(svc.name.padEnd(16))} ${svc.image.substring(0, 30).padEnd(32)} ${pc.cyan(url)}`);
        } else {
          console.log(
            `    ${pc.bold(svc.name.padEnd(16))} ${svc.image.substring(0, 30).padEnd(32)} ${svc.privateIp} (internal)`
          );
        }
      }
      console.log("");
    } catch (err) {
      // Atomic cleanup
      console.error("");
      console.error(pc.red("Provisioning failed. Cleaning up..."));

      for (const machineId of createdMachineIds) {
        try {
          await client.deleteMachine(createdAppName, machineId, true);
        } catch {
          // Best effort cleanup
        }
      }

      try {
        await client.deleteApp(createdAppName);
      } catch {
        // Best effort cleanup
      }

      console.error(pc.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

function orderServices(
  services: ComposeService[],
  webService: ComposeService | null
): ComposeService[] {
  // Simple topological sort: web service first, then services without deps, then with deps
  const ordered: ComposeService[] = [];
  const remaining = [...services];
  const placed = new Set<string>();

  // Web service first (if it has no dependencies)
  if (webService && webService.dependsOn.length === 0) {
    ordered.push(webService);
    placed.add(webService.name);
    const idx = remaining.findIndex((s) => s.name === webService.name);
    if (idx >= 0) remaining.splice(idx, 1);
  }

  // Simple iterative placement
  let maxIter = remaining.length * 2;
  while (remaining.length > 0 && maxIter > 0) {
    maxIter--;
    for (let i = 0; i < remaining.length; i++) {
      const service = remaining[i];
      const depsReady = service.dependsOn.every((d) => placed.has(d));
      if (depsReady) {
        ordered.push(service);
        placed.add(service.name);
        remaining.splice(i, 1);
        break;
      }
    }
  }

  // Add any remaining (circular deps fallback)
  ordered.push(...remaining);
  return ordered;
}
