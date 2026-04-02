import * as fs from "fs";
import * as yaml from "js-yaml";
import type { CreateMachineRequest, FlyService } from "./fly-client";

export interface ComposeService {
  name: string;
  image?: string;
  build?: {
    context: string;
    dockerfile?: string;
  };
  ports: Array<{ host: number; container: number }>;
  environment: Record<string, string>;
  command?: string[];
  dependsOn: string[];
}

export interface ParsedCompose {
  services: ComposeService[];
  webService: ComposeService | null;
  internalServices: ComposeService[];
}

const UNSUPPORTED_KEYS = ["volumes", "networks", "profiles", "secrets", "configs"];

export function parseComposeFile(filePath: string): ParsedCompose {
  const content = fs.readFileSync(filePath, "utf-8");
  return parseComposeContent(content);
}

export function parseComposeContent(content: string): ParsedCompose {
  const doc = yaml.load(content) as Record<string, unknown>;

  if (!doc || typeof doc !== "object" || !doc.services) {
    throw new Error("Compose file must contain a 'services' object");
  }

  const servicesObj = doc.services as Record<string, Record<string, unknown>>;

  if (typeof servicesObj !== "object" || Object.keys(servicesObj).length === 0) {
    throw new Error("Compose file must contain a 'services' object");
  }

  // Warn about unsupported top-level keys
  for (const key of Object.keys(doc)) {
    if (key !== "services" && UNSUPPORTED_KEYS.includes(key)) {
      console.warn(`Warning: '${key}' is not supported by cloudenv and will be ignored`);
    }
  }

  const services: ComposeService[] = [];

  for (const [name, def] of Object.entries(servicesObj)) {
    // Warn about unsupported service-level keys
    for (const key of Object.keys(def)) {
      if (UNSUPPORTED_KEYS.includes(key)) {
        console.warn(`Warning: '${key}' is not supported by cloudenv and will be ignored`);
      }
    }

    const service = parseService(name, def);
    services.push(service);
  }

  const webService = services.find((s) => s.ports.length > 0) ?? null;
  const internalServices = services.filter((s) => s !== webService);

  return { services, webService, internalServices };
}

function parseService(name: string, def: Record<string, unknown>): ComposeService {
  const image = def.image as string | undefined;
  const build = parseBuild(def.build);

  if (!image && !build) {
    throw new Error(`Service '${name}' must have either 'image' or 'build' field`);
  }

  return {
    name,
    image,
    build,
    ports: parsePorts(def.ports),
    environment: parseEnvironment(def.environment),
    command: parseCommand(def.command),
    dependsOn: parseDependsOn(def.depends_on),
  };
}

function parseBuild(
  build: unknown
): { context: string; dockerfile?: string } | undefined {
  if (build === undefined || build === null) {
    return undefined;
  }
  if (typeof build === "string") {
    return { context: build };
  }
  if (typeof build === "object") {
    const obj = build as Record<string, unknown>;
    return {
      context: (obj.context as string) || ".",
      dockerfile: obj.dockerfile as string | undefined,
    };
  }
  return undefined;
}

function parsePorts(
  ports: unknown
): Array<{ host: number; container: number }> {
  if (!ports || !Array.isArray(ports)) {
    return [];
  }

  return ports.map((p) => {
    if (typeof p === "object" && p !== null) {
      const obj = p as Record<string, unknown>;
      return {
        host: Number(obj.published),
        container: Number(obj.target),
      };
    }

    const str = String(p);
    if (str.includes(":")) {
      const [host, container] = str.split(":");
      return { host: Number(host), container: Number(container) };
    }

    const port = Number(str);
    return { host: port, container: port };
  });
}

function parseEnvironment(env: unknown): Record<string, string> {
  if (!env) {
    return {};
  }

  if (Array.isArray(env)) {
    const result: Record<string, string> = {};
    for (const item of env) {
      const str = String(item);
      const eqIndex = str.indexOf("=");
      if (eqIndex === -1) {
        result[str] = "";
      } else {
        result[str.slice(0, eqIndex)] = str.slice(eqIndex + 1);
      }
    }
    return result;
  }

  if (typeof env === "object") {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
      result[key] = String(value);
    }
    return result;
  }

  return {};
}

function parseCommand(cmd: unknown): string[] | undefined {
  if (!cmd) {
    return undefined;
  }
  if (Array.isArray(cmd)) {
    return cmd.map(String);
  }
  if (typeof cmd === "string") {
    return cmd.split(" ");
  }
  return undefined;
}

function parseDependsOn(deps: unknown): string[] {
  if (!deps) {
    return [];
  }
  if (Array.isArray(deps)) {
    return deps.map(String);
  }
  if (typeof deps === "object") {
    return Object.keys(deps as Record<string, unknown>);
  }
  return [];
}

export function toFlyMachineConfig(
  service: ComposeService,
  appName: string,
  isWeb: boolean,
  region?: string
): CreateMachineRequest {
  const sanitizedName = service.name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const config: CreateMachineRequest["config"] = {
    image: service.image || "",
    env: service.environment,
    guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
    restart: { policy: "on-failure" },
    metadata: { cloudenv: "true", service: service.name },
  };

  if (isWeb && service.ports.length > 0) {
    config.services = [
      {
        protocol: "tcp",
        internal_port: service.ports[0].container,
        ports: [
          { port: 80, handlers: ["http"], force_https: true },
          { port: 443, handlers: ["tls", "http"] },
        ],
      },
    ];
  }

  if (service.command) {
    config.init = { cmd: service.command };
  }

  const request: CreateMachineRequest = {
    name: sanitizedName,
    config,
  };

  if (region) {
    request.region = region;
  }

  return request;
}

export function generateAppName(repo: string, branch: string): string {
  const raw = `ce-${repo}-${branch}`;
  let sanitized = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  sanitized = sanitized.slice(0, 30).replace(/-$/, "");

  if (!sanitized) {
    return "cloudenv-app";
  }

  return sanitized;
}
