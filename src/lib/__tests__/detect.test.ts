import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { detectNode, detectPython, detectGo, detectStack } from "../detect";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cloudenv-detect-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectNode", () => {
  it("detects a basic Node.js project", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      scripts: { start: "node server.js" },
      dependencies: { express: "^4.0.0" },
    }));

    const result = detectNode(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.runtime).toBe("node");
    expect(result!.version).toBe("20");
    expect(result!.entrypoint).toBe("node server.js");
    expect(result!.port).toBe(3000);
    expect(result!.databases).toHaveLength(0);
  });

  it("detects postgres from prisma dependency", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      scripts: { start: "next start" },
      dependencies: { next: "^14.0.0", "@prisma/client": "^5.0.0" },
    }));

    const result = detectNode(tmpDir);
    expect(result!.databases).toHaveLength(1);
    expect(result!.databases[0].type).toBe("postgres");
    expect(result!.databases[0].image).toBe("postgres:16-alpine");
  });

  it("detects redis from ioredis dependency", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      dependencies: { express: "^4.0.0", ioredis: "^5.0.0" },
    }));

    const result = detectNode(tmpDir);
    expect(result!.databases).toHaveLength(1);
    expect(result!.databases[0].type).toBe("redis");
  });

  it("detects multiple databases", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      dependencies: { express: "^4.0.0", pg: "^8.0.0", redis: "^4.0.0" },
    }));

    const result = detectNode(tmpDir);
    expect(result!.databases).toHaveLength(2);
    const types = result!.databases.map((d) => d.type);
    expect(types).toContain("postgres");
    expect(types).toContain("redis");
  });

  it("reads node version from engines field", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      engines: { node: ">=18.0.0" },
      dependencies: { express: "^4.0.0" },
    }));

    const result = detectNode(tmpDir);
    expect(result!.version).toBe("18");
  });

  it("returns null when no package.json", () => {
    expect(detectNode(tmpDir)).toBeNull();
  });

  it("detects existing Dockerfile", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: {} }));
    fs.writeFileSync(path.join(tmpDir, "Dockerfile"), "FROM node:20");

    const result = detectNode(tmpDir);
    expect(result!.hasDockerfile).toBe(true);
  });
});

describe("detectPython", () => {
  it("detects a Django project", () => {
    fs.writeFileSync(path.join(tmpDir, "requirements.txt"), "django==4.2\npsycopg2-binary==2.9\n");

    const result = detectPython(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.runtime).toBe("python");
    expect(result!.entrypoint).toContain("manage.py");
    expect(result!.port).toBe(8000);
    expect(result!.databases).toHaveLength(1);
    expect(result!.databases[0].type).toBe("postgres");
  });

  it("detects FastAPI with redis", () => {
    fs.writeFileSync(path.join(tmpDir, "requirements.txt"), "fastapi\nuvicorn\nredis\n");

    const result = detectPython(tmpDir);
    expect(result!.entrypoint).toContain("uvicorn");
    expect(result!.databases).toHaveLength(1);
    expect(result!.databases[0].type).toBe("redis");
  });

  it("detects Flask", () => {
    fs.writeFileSync(path.join(tmpDir, "requirements.txt"), "flask\n");

    const result = detectPython(tmpDir);
    expect(result!.entrypoint).toContain("flask");
    expect(result!.port).toBe(5000);
  });

  it("returns null when no requirements.txt or pyproject.toml", () => {
    expect(detectPython(tmpDir)).toBeNull();
  });
});

describe("detectGo", () => {
  it("detects a Go project with pgx", () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), `module myapp

go 1.22

require (
\tgithub.com/jackc/pgx/v5 v5.5.0
)
`);

    const result = detectGo(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.runtime).toBe("go");
    expect(result!.version).toBe("1.22");
    expect(result!.port).toBe(8080);
    expect(result!.databases).toHaveLength(1);
    expect(result!.databases[0].type).toBe("postgres");
  });

  it("returns null when no go.mod", () => {
    expect(detectGo(tmpDir)).toBeNull();
  });
});

describe("detectStack", () => {
  it("prefers Node.js when package.json exists", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: {} }));
    fs.writeFileSync(path.join(tmpDir, "requirements.txt"), "flask\n");

    const result = detectStack(tmpDir);
    expect(result!.runtime).toBe("node");
  });

  it("falls back to Python when no package.json", () => {
    fs.writeFileSync(path.join(tmpDir, "requirements.txt"), "flask\n");

    const result = detectStack(tmpDir);
    expect(result!.runtime).toBe("python");
  });

  it("returns null for empty directory", () => {
    expect(detectStack(tmpDir)).toBeNull();
  });
});
