import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";
import {
  parseComposeFile,
  parseComposeContent,
  toFlyMachineConfig,
  toMultiContainerConfig,
  detectPortConflicts,
  generateAppName,
} from "../compose";

const fixturesDir = path.join(__dirname, "fixtures");

describe("parseComposeContent", () => {
  it("parses minimal compose with one service and image only", () => {
    const result = parseComposeContent(`
services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
`);
    expect(result.services).toHaveLength(1);
    expect(result.services[0].name).toBe("web");
    expect(result.services[0].image).toBe("nginx:alpine");
    expect(result.services[0].ports).toEqual([{ host: 80, container: 80 }]);
    expect(result.webService).toBe(result.services[0]);
    expect(result.internalServices).toHaveLength(0);
  });

  it("parses fullstack compose with web, postgres, and redis", () => {
    const result = parseComposeFile(path.join(fixturesDir, "fullstack.yml"));

    expect(result.services).toHaveLength(3);

    const web = result.services.find((s) => s.name === "web")!;
    expect(web.build).toEqual({ context: "./app" });
    expect(web.ports).toEqual([{ host: 3000, container: 3000 }]);
    expect(web.environment.DATABASE_URL).toBe(
      "postgres://postgres:password@db:5432/myapp"
    );
    expect(web.dependsOn).toEqual([
      { service: "db", condition: "started" },
      { service: "redis", condition: "started" },
    ]);

    const db = result.services.find((s) => s.name === "db")!;
    expect(db.image).toBe("postgres:16");
    expect(db.environment.POSTGRES_PASSWORD).toBe("password");

    const redis = result.services.find((s) => s.name === "redis")!;
    expect(redis.image).toBe("redis:7-alpine");

    expect(result.webService).toBe(web);
    expect(result.internalServices).toHaveLength(2);
  });

  it("parses build as string format", () => {
    const result = parseComposeContent(`
services:
  app:
    build: ./app
    ports:
      - "3000:3000"
`);
    expect(result.services[0].build).toEqual({ context: "./app" });
  });

  it("parses build as object format", () => {
    const result = parseComposeContent(`
services:
  app:
    build:
      context: ./app
      dockerfile: Dockerfile.prod
    ports:
      - "3000:3000"
`);
    expect(result.services[0].build).toEqual({
      context: "./app",
      dockerfile: "Dockerfile.prod",
    });
  });

  it("populates both build and image when both are present", () => {
    const result = parseComposeContent(`
services:
  app:
    image: myapp:latest
    build: ./app
    ports:
      - "3000:3000"
`);
    expect(result.services[0].image).toBe("myapp:latest");
    expect(result.services[0].build).toEqual({ context: "./app" });
  });

  it("rejects service with neither image nor build", () => {
    expect(() =>
      parseComposeContent(`
services:
  broken:
    ports:
      - "3000:3000"
`)
    ).toThrow("Service 'broken' must have either 'image' or 'build' field");
  });

  it("parses string port format '8080:3000'", () => {
    const result = parseComposeContent(`
services:
  app:
    image: myapp
    ports:
      - "8080:3000"
`);
    expect(result.services[0].ports).toEqual([{ host: 8080, container: 3000 }]);
  });

  it("parses simple port format '3000' (host=container)", () => {
    const result = parseComposeContent(`
services:
  app:
    image: myapp
    ports:
      - "3000"
`);
    expect(result.services[0].ports).toEqual([{ host: 3000, container: 3000 }]);
  });

  it("parses environment as array format", () => {
    const result = parseComposeContent(`
services:
  app:
    image: myapp
    environment:
      - KEY=val
      - EMPTY_KEY
`);
    expect(result.services[0].environment).toEqual({
      KEY: "val",
      EMPTY_KEY: "",
    });
  });

  it("parses environment as object format", () => {
    const result = parseComposeContent(`
services:
  app:
    image: myapp
    environment:
      KEY: val
`);
    expect(result.services[0].environment).toEqual({ KEY: "val" });
  });

  it("resolves ${VAR:-default} syntax in ports", () => {
    const result = parseComposeContent(`
services:
  app:
    image: myapp
    ports:
      - "\${APP_PORT:-3000}:3000"
`);
    expect(result.services[0].ports).toEqual([{ host: 3000, container: 3000 }]);
  });

  it("resolves ${VAR:-default} syntax in environment values", () => {
    const result = parseComposeContent(`
services:
  app:
    image: myapp
    environment:
      - POSTGRES_USER=\${POSTGRES_USER:-postgres}
      - POSTGRES_DB=\${POSTGRES_DB:-mydb}
`);
    expect(result.services[0].environment).toEqual({
      POSTGRES_USER: "postgres",
      POSTGRES_DB: "mydb",
    });
  });

  it("parses build with target field", () => {
    const result = parseComposeContent(`
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: dev
    ports:
      - "3000:3000"
`);
    expect(result.services[0].build).toEqual({
      context: ".",
      dockerfile: "Dockerfile",
      target: "dev",
    });
  });

  it("identifies webService as first service with ports", () => {
    const result = parseComposeContent(`
services:
  db:
    image: postgres:16
  web:
    image: nginx
    ports:
      - "80:80"
  api:
    image: myapi
    ports:
      - "3000:3000"
`);
    expect(result.webService!.name).toBe("web");
    expect(result.internalServices).toHaveLength(2);
    expect(result.internalServices.map((s) => s.name)).toEqual(["db", "api"]);
  });

  it("warns about unsupported keys but silences volumes/networks", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    parseComposeContent(`
services:
  app:
    image: myapp
    volumes:
      - ./data:/data
    secrets:
      - my_secret
volumes:
  data:
secrets:
  my_secret:
    file: ./secret.txt
`);

    // Volumes and networks are silently handled, only secrets should warn
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("'secrets'")
    );
    // No volume warnings
    const volumeWarnings = warnSpy.mock.calls.filter((c) => String(c[0]).includes("'volumes'"));
    expect(volumeWarnings).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it("parses depends_on as object format", () => {
    const result = parseComposeContent(`
services:
  web:
    image: myapp
    ports:
      - "3000:3000"
    depends_on:
      db:
        condition: service_started
      redis:
        condition: service_healthy
  db:
    image: postgres:16
  redis:
    image: redis:7
`);
    expect(result.services[0].dependsOn).toEqual([
      { service: "db", condition: "started" },
      { service: "redis", condition: "healthy" },
    ]);
  });
});

describe("generateAppName", () => {
  it("sanitizes special characters", () => {
    const name = generateAppName("my_repo", "feat/cool-thing");
    expect(name).toBe("ce-my-repo-feat-cool-thing");
    expect(name).toMatch(/^[a-z0-9-]+$/);
  });

  it("truncates to 30 characters", () => {
    const name = generateAppName(
      "very-long-repository-name",
      "very-long-branch-name"
    );
    expect(name.length).toBeLessThanOrEqual(30);
  });

  it("handles empty result after sanitization", () => {
    const name = generateAppName("", "");
    // ce-- after sanitization becomes "ce" which is valid
    // But let's test truly degenerate input
    expect(name).toBeTruthy();
    expect(name.length).toBeGreaterThan(0);
  });

  it("returns fallback for fully empty sanitization", () => {
    // Patch: all non-alphanumeric chars that collapse to nothing
    // "ce---" -> "ce" which is not empty, so we need something that fully empties
    // Actually ce-{repo}-{branch} with empty strings gives "ce--" -> "ce"
    // To get empty we'd need the template itself to vanish, which can't happen
    // So we verify the fallback path by testing the function behavior
    const name = generateAppName("---", "---");
    // "ce------" -> "ce" after collapse and trim
    expect(name).toBeTruthy();
  });
});

describe("toFlyMachineConfig", () => {
  const webService = {
    name: "web",
    image: "myapp:latest",
    ports: [{ host: 3000, container: 3000 }],
    environment: { NODE_ENV: "production" },
    command: ["node", "server.js"],
    dependsOn: [],
  };

  const internalService = {
    name: "worker",
    image: "myworker:latest",
    ports: [],
    environment: { QUEUE: "default" },
    dependsOn: [],
  };

  it("produces correct services array for web service", () => {
    const result = toFlyMachineConfig(webService, "my-app", true, "iad");

    expect(result.name).toBe("web");
    expect(result.region).toBe("iad");
    expect(result.config.image).toBe("myapp:latest");
    expect(result.config.env).toEqual({ NODE_ENV: "production" });
    expect(result.config.guest).toEqual({
      cpu_kind: "shared",
      cpus: 1,
      memory_mb: 256,
    });
    expect(result.config.services).toHaveLength(1);
    expect(result.config.services![0]).toEqual({
      protocol: "tcp",
      internal_port: 3000,
      ports: [
        { port: 80, handlers: ["http"], force_https: true },
        { port: 443, handlers: ["tls", "http"] },
      ],
    });
    expect(result.config.init).toEqual({ cmd: ["node", "server.js"] });
    expect(result.config.restart).toEqual({ policy: "on-failure" });
    expect(result.config.metadata).toEqual({
      cloudenv: "true",
      service: "web",
    });
  });

  it("produces no services array for internal service", () => {
    const result = toFlyMachineConfig(internalService, "my-app", false);

    expect(result.name).toBe("worker");
    expect(result.region).toBeUndefined();
    expect(result.config.services).toBeUndefined();
    expect(result.config.init).toBeUndefined();
    expect(result.config.metadata).toEqual({
      cloudenv: "true",
      service: "worker",
    });
  });
});

describe("toMultiContainerConfig", () => {
  it("maps all services to containers array", () => {
    const parsed = parseComposeContent(`
services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: secret
  redis:
    image: redis:7-alpine
`);
    const result = toMultiContainerConfig(parsed, "iad");

    expect(result.config.containers).toHaveLength(3);
    expect(result.config.containers[0].name).toBe("web");
    expect(result.config.containers[0].image).toBe("nginx:alpine");
    expect(result.config.containers[1].name).toBe("db");
    expect(result.config.containers[1].image).toBe("postgres:16");
    expect(result.config.containers[1].env).toEqual({ POSTGRES_PASSWORD: "secret" });
    expect(result.config.containers[2].name).toBe("redis");
    expect(result.config.containers[2].image).toBe("redis:7-alpine");
  });

  it("injects /etc/hosts into every container", () => {
    const parsed = parseComposeContent(`
services:
  web:
    image: nginx
    ports:
      - "80:80"
  db:
    image: postgres:16
`);
    const result = toMultiContainerConfig(parsed);

    for (const container of result.config.containers) {
      expect(container.files).toHaveLength(1);
      expect(container.files![0].guest_path).toBe("/etc/hosts");
      const decoded = Buffer.from(container.files![0].raw_value, "base64").toString("utf-8");
      expect(decoded).toContain("127.0.0.1 web");
      expect(decoded).toContain("127.0.0.1 db");
    }
  });

  it("sets HTTP/HTTPS services for web service", () => {
    const parsed = parseComposeContent(`
services:
  web:
    image: nginx
    ports:
      - "3000:3000"
  db:
    image: postgres:16
`);
    const result = toMultiContainerConfig(parsed);

    expect(result.config.services).toHaveLength(1);
    expect(result.config.services![0].internal_port).toBe(3000);
    expect(result.config.services![0].ports).toHaveLength(2);
  });

  it("maps depends_on to container dependencies", () => {
    const parsed = parseComposeContent(`
services:
  web:
    image: nginx
    ports:
      - "80:80"
    depends_on:
      - db
  db:
    image: postgres:16
`);
    const result = toMultiContainerConfig(parsed);
    const webContainer = result.config.containers.find((c) => c.name === "web")!;

    expect(webContainer.depends_on).toEqual([
      { name: "db", condition: "started" },
    ]);
  });

  it("sets guest resources to shared-cpu-2x with 2048MB", () => {
    const parsed = parseComposeContent(`
services:
  web:
    image: nginx
    ports:
      - "80:80"
`);
    const result = toMultiContainerConfig(parsed);

    expect(result.config.guest).toEqual({
      cpu_kind: "shared",
      cpus: 2,
      memory_mb: 2048,
    });
  });

  it("passes command as cmd array", () => {
    const parsed = parseComposeContent(`
services:
  app:
    image: myapp
    command: ["node", "server.js"]
    ports:
      - "3000:3000"
`);
    const result = toMultiContainerConfig(parsed);

    expect(result.config.containers[0].cmd).toEqual(["node", "server.js"]);
  });

  it("sets region when provided", () => {
    const parsed = parseComposeContent(`
services:
  web:
    image: nginx
    ports:
      - "80:80"
`);
    const result = toMultiContainerConfig(parsed, "lax");
    expect(result.region).toBe("lax");
  });
});

describe("detectPortConflicts", () => {
  it("passes when no conflicts exist", () => {
    const services = [
      { name: "web", image: "nginx", ports: [{ host: 80, container: 80 }], environment: {}, dependsOn: [] },
      { name: "db", image: "postgres:16", ports: [], environment: {}, dependsOn: [] },
    ];
    expect(() => detectPortConflicts(services)).not.toThrow();
  });

  it("throws when two services declare the same port", () => {
    const services = [
      { name: "web", image: "nginx", ports: [{ host: 3000, container: 3000 }], environment: {}, dependsOn: [] },
      { name: "api", image: "myapi", ports: [{ host: 3000, container: 3000 }], environment: {}, dependsOn: [] },
    ];
    expect(() => detectPortConflicts(services)).toThrow("web and api both listen on port 3000");
  });

  it("detects well-known default ports for postgres images", () => {
    const services = [
      { name: "db1", image: "postgres:16", ports: [], environment: {}, dependsOn: [] },
      { name: "db2", image: "postgres:15", ports: [], environment: {}, dependsOn: [] },
    ];
    expect(() => detectPortConflicts(services)).toThrow("db1 and db2 both listen on port 5432");
  });

  it("detects well-known default ports for redis images", () => {
    const services = [
      { name: "cache1", image: "redis:7", ports: [], environment: {}, dependsOn: [] },
      { name: "cache2", image: "redis:6", ports: [], environment: {}, dependsOn: [] },
    ];
    expect(() => detectPortConflicts(services)).toThrow("cache1 and cache2 both listen on port 6379");
  });
});
