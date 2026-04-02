import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface EnvRecord {
  appName: string;
  repo: string;
  branch: string;
  url: string;
  services: Array<{
    name: string;
    machineId: string;
    image: string;
    privateIp: string;
    isWeb: boolean;
  }>;
  createdAt: string;
}

export function getEnvStorePath(): string {
  return path.join(os.homedir(), ".cloudenv", "envs.json");
}

export function loadEnvStore(): EnvRecord[] {
  const storePath = getEnvStorePath();
  if (!fs.existsSync(storePath)) {
    return [];
  }
  const raw = fs.readFileSync(storePath, "utf-8");
  return JSON.parse(raw) as EnvRecord[];
}

export function saveEnv(env: EnvRecord): void {
  const records = loadEnvStore();
  records.push(env);
  writeEnvStore(records);
}

export function removeEnv(appName: string): void {
  const records = loadEnvStore();
  const filtered = records.filter((r) => r.appName !== appName);
  writeEnvStore(filtered);
}

export function findEnv(appName: string): EnvRecord | undefined {
  const records = loadEnvStore();
  return records.find((r) => r.appName === appName);
}

export function findEnvByBranch(branch: string): EnvRecord | undefined {
  const records = loadEnvStore();
  return records.find((r) => r.branch === branch);
}

function writeEnvStore(records: EnvRecord[]): void {
  const storePath = getEnvStorePath();
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(records, null, 2) + "\n");
}
