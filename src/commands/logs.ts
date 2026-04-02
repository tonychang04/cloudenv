import { Command } from "commander";
import { execSync } from "child_process";
import pc from "picocolors";
import { findEnv } from "../lib/env-store";

export const logsCommand = new Command("logs")
  .description("View logs from an environment")
  .argument("<env>", "Environment name")
  .argument("[service]", "Service name (optional)")
  .action((env: string, service: string | undefined) => {
    const envRecord = findEnv(env);
    if (!envRecord) {
      console.error(pc.red(`Environment "${env}" not found.`));
      process.exit(1);
    }

    if (service) {
      const svc = envRecord.services.find((s) => s.name === service);
      if (!svc) {
        console.error(
          pc.red(
            `Service "${service}" not found in environment "${env}". Available: ${envRecord.services.map((s) => s.name).join(", ")}`
          )
        );
        process.exit(1);
      }
    }

    // Try flyctl first
    if (hasFlyctl()) {
      try {
        console.log(pc.dim(`Streaming logs from ${env}...\n`));
        execSync(`flyctl logs -a ${env}`, {
          stdio: "inherit",
          encoding: "utf-8",
        });
        return;
      } catch {
        // flyctl might not be authenticated or failed
      }
    }

    // Fallback: point to dashboard
    console.log(
      pc.yellow(
        "Log streaming requires flyctl. Install it from https://fly.io/docs/hands-on/install-flyctl/"
      )
    );
    console.log("");
    console.log(
      `View logs in your browser: ${pc.cyan(`https://fly.io/apps/${env}/monitoring`)}`
    );
  });

function hasFlyctl(): boolean {
  try {
    execSync("flyctl version", {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    });
    return true;
  } catch {
    return false;
  }
}
