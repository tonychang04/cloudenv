import * as fs from "fs";
import * as yaml from "js-yaml";
import type { CreateMachineRequest, FlyService, FlyContainerConfig } from "./fly-client";
import { generateHostsFileBase64 } from "./hosts";

export interface ComposeService {
  name: string;
  image?: string;
  build?: {
    context: string;
    dockerfile?: string;
    target?: string;
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

  // Find the web service using heuristics:
  // 1. Prefer a service with build: (it's the user's app, not infra)
  // 2. Skip services whose ports are all well-known infra ports
  // 3. Fall back to first service with any port
  const INFRA_PORTS = new Set([5432, 3306, 6379, 27017, 11211, 2181, 9092, 8500, 6443]);

  const webService = (
    // First: service with build: AND non-infra ports
    services.find((s) => s.build && s.ports.length > 0 && s.ports.some((p) => !INFRA_PORTS.has(p.container)))
    // Second: any service with non-infra ports
    || services.find((s) => s.ports.length > 0 && s.ports.some((p) => !INFRA_PORTS.has(p.container)))
    // Last resort: first service with any ports
    || services.find((s) => s.ports.length > 0)
    || null
  );
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
): { context: string; dockerfile?: string; target?: string } | undefined {
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
      target: obj.target as string | undefined,
    };
  }
  return undefined;
}

// Resolve ${VAR:-default} to the default value, or strip ${VAR} to empty
function resolveEnvVar(value: string): string {
  return value.replace(/\$\{[^}]*:-([^}]*)\}/g, "$1").replace(/\$\{[^}]*\}/g, "");
}

function parsePorts(
  ports: unknown
): Array<{ host: number; container: number }> {
  if (!ports || !Array.isArray(ports)) {
    return [];
  }

  return ports
    .map((p) => {
      if (typeof p === "object" && p !== null) {
        const obj = p as Record<string, unknown>;
        return {
          host: Number(resolveEnvVar(String(obj.published))),
          container: Number(resolveEnvVar(String(obj.target))),
        };
      }

      const str = resolveEnvVar(String(p));
      if (str.includes(":")) {
        const [host, container] = str.split(":");
        return { host: Number(host), container: Number(container) };
      }

      const port = Number(str);
      return { host: port, container: port };
    })
    .filter((p) => !isNaN(p.host) && !isNaN(p.container));
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
        result[str.slice(0, eqIndex)] = resolveEnvVar(str.slice(eqIndex + 1));
      }
    }
    return result;
  }

  if (typeof env === "object") {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
      result[key] = resolveEnvVar(String(value));
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

// Well-known default ports for common database images
const WELL_KNOWN_PORTS: Record<string, number> = {
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
  redis: 6379,
  mongo: 27017,
  memcached: 11211,
};

function getDefaultPort(image: string | undefined): number | undefined {
  if (!image) return undefined;
  const imageName = image.split(":")[0].split("/").pop() || "";
  return WELL_KNOWN_PORTS[imageName];
}

export function detectPortConflicts(services: ComposeService[]): void {
  const portMap = new Map<number, string[]>();

  for (const service of services) {
    const ports = new Set<number>();

    // Explicit ports
    for (const p of service.ports) {
      ports.add(p.container);
    }

    // Well-known default ports based on image name
    const defaultPort = getDefaultPort(service.image);
    if (defaultPort) {
      ports.add(defaultPort);
    }

    for (const port of ports) {
      const existing = portMap.get(port) || [];
      existing.push(service.name);
      portMap.set(port, existing);
    }
  }

  for (const [port, serviceNames] of portMap) {
    if (serviceNames.length > 1) {
      throw new Error(
        `Services ${serviceNames.join(" and ")} both listen on port ${port}. ` +
        `This is not supported in single-machine mode.`
      );
    }
  }
}

export interface MultiContainerMachineConfig {
  region?: string;
  config: {
    image: string;
    guest: { cpu_kind: string; cpus: number; memory_mb: number };
    services?: FlyService[];
    restart: { policy: string };
    metadata: Record<string, string>;
    containers: FlyContainerConfig[];
  };
}

export function toMultiContainerConfig(
  parsed: ParsedCompose,
  region?: string
): MultiContainerMachineConfig {
  const serviceNames = parsed.services.map((s) => s.name);
  const hostsBase64 = generateHostsFileBase64(serviceNames);

  const containers: FlyContainerConfig[] = parsed.services.map((service) => {
    const container: FlyContainerConfig = {
      name: service.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""),
      image: service.image || "",
      files: [{ guest_path: "/etc/hosts", raw_value: hostsBase64 }],
    };

    if (Object.keys(service.environment).length > 0) {
      container.env = service.environment;
    }

    if (service.command) {
      container.cmd = service.command;
    }

    if (service.dependsOn.length > 0) {
      container.depends_on = service.dependsOn.map((dep) => ({
        name: dep,
        condition: "started" as const,
      }));
    }

    return container;
  });

  const machineConfig: MultiContainerMachineConfig = {
    config: {
      image: parsed.webService?.image || parsed.services[0].image || "",
      guest: { cpu_kind: "shared", cpus: 2, memory_mb: 2048 },
      restart: { policy: "on-failure" },
      metadata: { cloudenv: "true" },
      containers,
    },
  };

  // Add HTTP/HTTPS services for the web-facing container
  if (parsed.webService && parsed.webService.ports.length > 0) {
    machineConfig.config.services = [
      {
        protocol: "tcp",
        internal_port: parsed.webService.ports[0].container,
        ports: [
          { port: 80, handlers: ["http"], force_https: true },
          { port: 443, handlers: ["tls", "http"] },
        ],
      },
    ];
  }

  if (region) {
    machineConfig.region = region;
  }

  return machineConfig;
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
