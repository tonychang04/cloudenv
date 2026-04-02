import { Command } from "commander";
import * as readline from "readline";
import pc from "picocolors";
import { createSpinner } from "nanospinner";
import { loadConfig } from "../lib/config";
import { FlyClient } from "../lib/fly-client";
import { findEnv, findEnvByBranch, removeEnv } from "../lib/env-store";
import { getBranchName } from "../lib/git";

export const downCommand = new Command("down")
  .description("Destroy an environment")
  .argument("[env-name]", "Environment name (defaults to current branch)")
  .option("--force", "Skip confirmation", false)
  .action(async (envName: string | undefined, options: { force: boolean }) => {
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

    const env = findEnv(appName);
    if (!env) {
      console.error(
        pc.yellow(
          `Environment "${appName}" not found in local store. Attempting to destroy on Fly.io anyway...`
        )
      );
    }

    // Confirm
    if (!options.force) {
      const displayName = env ? `${env.appName} (${env.branch})` : appName;
      const confirmed = await confirm(
        `Destroy environment ${pc.bold(displayName)}? (y/N) `
      );
      if (!confirmed) {
        console.log("Aborted.");
        return;
      }
    }

    const targetApp = appName;

    // Destroy machines first
    const spinner = createSpinner(`Destroying ${pc.bold(targetApp)}...`).start();
    try {
      const machines = await client.listMachines(targetApp);
      for (const machine of machines) {
        await client.deleteMachine(targetApp, machine.id, true);
      }
      await client.deleteApp(targetApp);
      removeEnv(targetApp);
      spinner.success({ text: `Destroyed ${pc.bold(targetApp)}` });
    } catch (err) {
      spinner.error({ text: `Failed to destroy ${targetApp}` });
      console.error(pc.red(err instanceof Error ? err.message : String(err)));
      // Still try to remove from local store
      removeEnv(targetApp);
      process.exit(1);
    }
  });

function confirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}
