import { Command } from "commander";
import pc from "picocolors";
import { loadEnvStore } from "../lib/env-store";

export const listCommand = new Command("list")
  .alias("ls")
  .description("Show running environments")
  .option("--json", "Output as JSON", false)
  .action((options: { json: boolean }) => {
    const envs = loadEnvStore();

    if (envs.length === 0) {
      console.log(pc.dim("No environments running."));
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(envs, null, 2));
      return;
    }

    // Print table
    const header = `${"NAME".padEnd(32)} ${"BRANCH".padEnd(20)} ${"SERVICES".padEnd(10)} ${"URL".padEnd(45)} ${"CREATED"}`;
    console.log(pc.bold(header));
    console.log(pc.dim("─".repeat(header.length)));

    for (const env of envs) {
      const age = getRelativeTime(env.createdAt);
      console.log(
        `${env.appName.padEnd(32)} ${env.branch.padEnd(20)} ${String(env.services.length).padEnd(10)} ${pc.cyan(env.url.padEnd(45))} ${pc.dim(age)}`
      );
    }
  });

function getRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
