import { Command } from "commander";
import * as path from "path";
import pc from "picocolors";
import { createSpinner } from "nanospinner";
import { loadConfig } from "../lib/config";
import { FlyClient, FlyApiError } from "../lib/fly-client";
import {
  parseComposeFile,
  generateAppName,
  toMultiContainerConfig,
  detectPortConflicts,
  preflightCheck,
} from "../lib/compose";
import { buildAndPushAsync, checkDockerAvailable, checkFlyctlAvailable } from "../lib/docker";
import { saveEnv, findEnv, findEnvByBranch, EnvRecord } from "../lib/env-store";
import { getBranchName, getRepoName } from "../lib/git";
import { detectStack } from "../lib/detect";
import { writeGeneratedFiles } from "../lib/generate-compose";
import * as fs from "fs";

export const upCommand = new Command("up")
  .description("Provision environment from docker-compose.yml or auto-detect")
  .option("-f, --file <path>", "Path to docker-compose.yml")
  .option("--region <region>", "Fly.io region", "iad")
  .option("--name <name>", "Override environment name")
  .option("--port <port>", "Override the public-facing port (e.g., 7132)")
  .action(async (options: { file?: string; region: string; name?: string; port?: string }) => {
    const config = loadConfig();
    const client = new FlyClient({ token: config.flyApiToken });
    const projectDir = process.cwd();

    // Detection chain: explicit file > prod compose > default compose > cloudenv compose > auto-detect
    // Prefer prod compose files over dev ones (dev files use volume mounts that don't work on Fly)
    let composePath: string;
    if (options.file) {
      composePath = path.resolve(options.file);
    } else {
      const prodCandidates = [
        "docker-compose.prod.yml",
        "docker-compose.production.yml",
        "docker-compose.prod.yaml",
        "docker-compose.production.yaml",
      ];
      const defaultCandidates = [
        "docker-compose.yml",
        "docker-compose.yaml",
      ];
      const cloudenvPath = path.resolve("docker-compose.cloudenv.yml");

      const prodFile = prodCandidates.find((f) => fs.existsSync(path.resolve(f)));
      const defaultFile = defaultCandidates.find((f) => fs.existsSync(path.resolve(f)));

      if (prodFile) {
        composePath = path.resolve(prodFile);
        console.log(pc.cyan(`Using ${prodFile} (production config)`));
      } else if (defaultFile) {
        composePath = path.resolve(defaultFile);
      } else if (fs.existsSync(cloudenvPath)) {
        composePath = cloudenvPath;
      } else {
        // Auto-detect stack
        const detected = detectStack(projectDir);
        if (!detected) {
          console.error(pc.red("Can't detect your project's stack."));
          console.error(pc.red("Add a Dockerfile or docker-compose.yml and try again."));
          process.exit(1);
        }

        const runtimeLabel = detected.runtime === "node" ? "Node.js" : detected.runtime === "python" ? "Python" : "Go";
        const dbLabels = detected.databases.map((d) => d.type).join(" + ");
        const detectedLabel = dbLabels ? `${runtimeLabel} ${detected.version} + ${dbLabels}` : `${runtimeLabel} ${detected.version}`;
        console.log(pc.cyan(`Detected: ${detectedLabel}`));

        if (!checkDockerAvailable()) {
          console.error(pc.red("Docker is required to build and deploy auto-detected projects. Please install Docker."));
          process.exit(1);
        }

        const generated = writeGeneratedFiles(detected, projectDir);
        composePath = generated.composePath;
        console.log(pc.dim(`Generated ${path.basename(generated.composePath)}`));
        if (generated.dockerfilePath) {
          console.log(pc.dim(`Generated Dockerfile`));
        }
        if (generated.dockerignorePath) {
          console.log(pc.dim(`Generated .dockerignore`));
        }
        console.log("");
      }
    }

    // Parse compose file
    let parsed;
    try {
      parsed = parseComposeFile(composePath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`Failed to parse compose file: ${msg}`));
      process.exit(1);
    }

    // Preflight check — scan for issues before creating any Fly resources
    let composeContent: string;
    try {
      composeContent = fs.readFileSync(composePath, "utf-8");
    } catch {
      composeContent = "";
    }
    const issues = preflightCheck(composeContent);
    const errors = issues.filter((i) => i.level === "error");
    const warnings = issues.filter((i) => i.level === "warning");

    for (const w of warnings) {
      console.warn(pc.yellow(`⚠ ${w.service}: ${w.message}`));
    }

    // Auto-skip services with errors instead of blocking the whole deploy
    const errorServiceNames = new Set(errors.map((e) => e.service));
    if (errorServiceNames.size > 0) {
      for (const e of errors) {
        console.error(pc.red(`✗ ${e.service}: ${e.message}`));
      }
      const skipped = [...errorServiceNames].join(", ");
      console.log(pc.yellow(`Skipping ${skipped} (will deploy without)`));
      parsed.services = parsed.services.filter((s) => !errorServiceNames.has(s.name));
      if (parsed.services.length === 0) {
        console.error(pc.red("No deployable services remain after skipping."));
        process.exit(1);
      }
      // Recalculate web service after filtering
      const INFRA_PORTS = new Set([5432, 3306, 6379, 27017, 11211]);
      parsed.webService = (
        parsed.services.find((s) => s.build && s.ports.length > 0 && s.ports.some((p) => !INFRA_PORTS.has(p.container)))
        || parsed.services.find((s) => s.ports.length > 0 && s.ports.some((p) => !INFRA_PORTS.has(p.container)))
        || parsed.services.find((s) => s.ports.length > 0)
        || null
      );
      parsed.internalServices = parsed.services.filter((s) => s !== parsed.webService);
    }
    if (issues.length > 0) {
      console.log("");
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

    // Check if any services need docker build (no image, or local image name)
    const needsBuild = parsed.services.some(
      (s) => s.build && (!s.image || !s.image.includes("/"))
    );
    if (needsBuild && !checkDockerAvailable() && !checkFlyctlAvailable()) {
      const buildServices = parsed.services
        .filter((s) => s.build && (!s.image || !s.image.includes("/")))
        .map((s) => s.name);
      console.error(
        pc.red(
          `Docker is required to build ${buildServices.join(", ")}. Please start Docker and try again.`
        )
      );
      process.exit(1);
    }

    // Ensure cache app exists for built images (persists across env deploys)
    const cacheAppName = `ce-cache-${getRepoName()}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").substring(0, 30).replace(/-$/, "");
    if (needsBuild) {
      try {
        await client.createApp(cacheAppName, config.orgSlug);
      } catch (err) {
        // 422 = already exists, which is fine (cache app persists)
        if (!(err instanceof FlyApiError && err.status === 422)) {
          throw err;
        }
      }
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

    // Allocate IP addresses so the app gets a public URL
    const ipSpinner = createSpinner("Allocating IP addresses...").start();
    try {
      const v6 = await client.allocateIpAddress(createdAppName, "v6");
      let v4 = await client.allocateIpAddress(createdAppName, "shared_v4");
      if (!v4) {
        v4 = await client.allocateIpAddress(createdAppName, "v4");
      }
      const allocated = [v6, v4].filter(Boolean).map((ip) => ip!.address);
      ipSpinner.success({ text: `Allocated IPs: ${allocated.join(", ")}` });
    } catch (err) {
      ipSpinner.error({ text: "Failed to allocate IP addresses" });
      console.error(pc.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }

    // Check for port conflicts before provisioning
    try {
      detectPortConflicts(parsed.services);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(pc.red(msg));
      process.exit(1);
    }

    try {
      // Build images in PARALLEL for services that need it
      const servicesToBuild = parsed.services.filter((s) => {
        const needsBuild = s.build && (!s.image || !s.image.includes("/"));
        return needsBuild && s.build;
      });

      if (servicesToBuild.length > 0) {
        // Write fly.toml once for all parallel builds (avoids race condition)
        const projectDir = process.cwd();
        const flyTomlPath = path.join(projectDir, "fly.toml");
        const hadFlyToml = fs.existsSync(flyTomlPath);
        if (!hadFlyToml) {
          fs.writeFileSync(flyTomlPath, `app = "${cacheAppName}"\n`);
        }

        const buildNames = servicesToBuild.map((s) => s.name).join(", ");
        const buildSpinner = createSpinner(
          `Building ${servicesToBuild.length} image(s) in parallel (${buildNames})...`
        ).start();

        const buildPromises = servicesToBuild.map(async (service) => {
          const result = await buildAndPushAsync(
            service.name,
            service.build!.context,
            service.build!.dockerfile,
            cacheAppName,
            config.flyApiToken,
            service.build!.target,
            service.build!.args
          );
          service.image = result.imageRef;
        });

        const results = await Promise.allSettled(buildPromises);
        const failures = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

        if (failures.length > 0) {
          buildSpinner.error({ text: `${failures.length} build(s) failed` });
          for (const f of failures) {
            console.error(pc.red(`  ${f.reason}`));
          }
          throw new Error("Image builds failed");
        }

        buildSpinner.success({
          text: `Built ${servicesToBuild.length} image(s)`,
        });

        // Clean up temp fly.toml
        if (!hadFlyToml && fs.existsSync(flyTomlPath)) {
          fs.unlinkSync(flyTomlPath);
        }
      }

      // Create single multi-container machine
      const serviceNames = parsed.services.map((s) => s.name).join(", ");
      const machineSpinner = createSpinner(
        `Starting services (${serviceNames})...`
      ).start();

      const portOverride = options.port ? Number(options.port) : undefined;
      const machineConfig = toMultiContainerConfig(parsed, options.region, portOverride);
      const machine = await client.createMachine(createdAppName, machineConfig);

      // Wait for machine with retry (Fly API caps at 60s per call)
      let machineReady = false;
      for (let attempt = 0; attempt < 3 && !machineReady; attempt++) {
        try {
          await client.waitForMachine(createdAppName, machine.id, "started", 60);
          machineReady = true;
        } catch {
          if (attempt < 2) {
            // Check if machine is making progress before retrying
            const check = await client.listMachines(createdAppName);
            const m = check.find((x) => x.id === machine.id);
            if (m?.state === "started") {
              machineReady = true;
            }
            // else retry wait
          }
        }
      }

      // Get machine status for diagnostics
      const machines = await client.listMachines(createdAppName);
      const liveMachine = machines.find((m) => m.id === machine.id);
      const machineState = liveMachine?.state || "unknown";

      if (machineReady || machineState === "started") {
        // Check container health
        const containerStates = (liveMachine as unknown as { containers?: Array<{ name: string; state: string }> })?.containers || [];
        const unhealthy = containerStates.filter((c) => c.state !== "healthy" && c.state !== "started");

        if (unhealthy.length > 0) {
          machineSpinner.success({
            text: `Machine started — ${unhealthy.length} service(s) unhealthy`,
          });
          for (const c of unhealthy) {
            console.warn(pc.yellow(`  ⚠ ${c.name}: ${c.state}`));
          }
        } else {
          machineSpinner.success({
            text: `Started ${parsed.services.length} services in one machine — ${machine.private_ip}`,
          });
        }
      } else {
        machineSpinner.error({ text: `Machine failed to start (state: ${machineState})` });

        // Show container diagnostics
        const containerStates = (liveMachine as unknown as { containers?: Array<{ name: string; state: string; events?: Array<{ type: string; status: string }> }> })?.containers || [];
        if (containerStates.length > 0) {
          console.error(pc.red("\nContainer diagnostics:"));
          for (const c of containerStates) {
            const lastEvent = c.events?.[c.events.length - 1];
            const eventInfo = lastEvent ? ` (last event: ${lastEvent.type} → ${lastEvent.status})` : "";
            console.error(pc.red(`  ${c.name}: ${c.state}${eventInfo}`));
          }
        }

        throw new Error(`Machine did not reach started state (got: ${machineState})`);
      }

      // Build env services list (all share the same machine)
      const envServices: EnvRecord["services"] = parsed.services.map((service) => ({
        name: service.name,
        machineId: machine.id,
        image: service.image || "",
        privateIp: machine.private_ip,
        isWeb: parsed.webService?.name === service.name,
      }));

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
            `    ${pc.bold(svc.name.padEnd(16))} ${svc.image.substring(0, 30).padEnd(32)} localhost (internal)`
          );
        }
      }
      console.log("");
    } catch (err) {
      // Atomic cleanup — delete the app (takes all machines with it)
      console.error("");
      console.error(pc.red("Provisioning failed. Cleaning up..."));

      try {
        await client.deleteApp(createdAppName);
      } catch {
        // Best effort cleanup
      }

      console.error(pc.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });
