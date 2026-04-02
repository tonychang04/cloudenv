import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface CloudEnvConfig {
  flyApiToken: string;
  orgSlug: string; // default: "personal"
}

export function getConfigDir(): string {
  return path.join(os.homedir(), ".cloudenv");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export function loadConfig(): CloudEnvConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error("Not logged in. Run `cloudenv login` first.");
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as CloudEnvConfig;
}

export function saveConfig(config: CloudEnvConfig): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function hasConfig(): boolean {
  return fs.existsSync(getConfigPath());
}
