import { Command } from "commander";
import pc from "picocolors";
import { createSpinner } from "nanospinner";
import { loadConfig } from "../lib/config";
import { FlyClient } from "../lib/fly-client";
import { findEnv, findEnvByBranch } from "../lib/env-store";
import { getBranchName } from "../lib/git";

export const statusCommand = new Command("status")
  .description("Check health of an environment")
  .argument("[env-name]", "Environment name (defaults to current branch)")
  .option("--json", "Output as JSON", false)
  .action(async (envName: string | undefined, options: { json: boolean }) => {
    const config = loadConfig();
    const client = new FlyClient({ token: config.flyApiToken });

    // Find environment
    let appName = envName;
    if (!appName) {
      const branch = getBranchName();
      const env = findEnvByBranch(branch);
      if (env) {
        appName = env.appName;
      } else {
        console.error(
          pc.red(`No environment found for branch "${branch}". Specify an env name.`)
        );
        process.exit(1);
      }
    }

    const envRecord = findEnv(appName);
    if (!envRecord) {
      console.error(pc.red(`Environment "${appName}" not found.`));
      process.exit(1);
    }

    const spinner = createSpinner(`Checking ${pc.bold(appName)}...`).start();

    try {
      const machines = await client.listMachines(appName);

      const serviceStatuses = envRecord.services.map((svc) => {
        const machine = machines.find((m) => m.id === svc.machineId);
        return {
          name: svc.name,
          machineId: svc.machineId,
          state: machine?.state ?? "unknown",
          image: svc.image,
          isWeb: svc.isWeb,
          privateIp: svc.privateIp,
        };
      });

      const allHealthy = serviceStatuses.every((s) => s.state === "started");
      spinner.success({ text: `${pc.bold(appName)} — ${allHealthy ? pc.green("healthy") : pc.yellow("degraded")}` });

      if (options.json) {
        console.log(JSON.stringify({
          appName,
          url: envRecord.url,
          branch: envRecord.branch,
          healthy: allHealthy,
          services: serviceStatuses,
          createdAt: envRecord.createdAt,
        }, null, 2));
        return;
      }

      console.log("");
      console.log(`  URL:     ${pc.cyan(envRecord.url)}`);
      console.log(`  Branch:  ${envRecord.branch}`);
      console.log(`  Created: ${envRecord.createdAt}`);
      console.log("");
      console.log("  Services:");

      for (const svc of serviceStatuses) {
        const stateColor = svc.state === "started" ? pc.green : svc.state === "stopped" ? pc.red : pc.yellow;
        const webLabel = svc.isWeb ? " (web)" : "";
        console.log(
          `    ${pc.bold(svc.name.padEnd(16))} ${stateColor(svc.state.padEnd(12))} ${svc.privateIp}${webLabel}`
        );
      }
      console.log("");
    } catch (err) {
      spinner.error({ text: `Failed to check ${appName}` });
      console.error(pc.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });
