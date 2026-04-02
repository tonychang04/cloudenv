import { Command } from "commander";
import * as readline from "readline";
import pc from "picocolors";
import { FlyClient } from "../lib/fly-client";
import { saveConfig } from "../lib/config";

export const loginCommand = new Command("login")
  .description("Store Fly.io API token for authentication")
  .option("--token <token>", "Fly.io API token")
  .option("--org <org>", "Fly.io org slug", "personal")
  .action(async (options: { token?: string; org: string }) => {
    let token = options.token;

    if (!token) {
      token = await promptForToken();
    }

    if (!token) {
      console.error(pc.red("No token provided. Aborting."));
      process.exit(1);
    }

    // Validate token
    const client = new FlyClient({ token });
    try {
      await client.listApps(options.org);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown error";
      console.error(pc.red(`Invalid token or org: ${message}`));
      process.exit(1);
    }

    saveConfig({ flyApiToken: token, orgSlug: options.org });
    console.log(
      pc.green(`Logged in successfully. Org: ${pc.bold(options.org)}`)
    );
  });

function promptForToken(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question("Fly.io API token: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
