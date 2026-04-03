import * as fs from "fs";
import * as path from "path";

export interface DetectedDB {
  type: "postgres" | "redis" | "mongo" | "mysql";
  image: string;
  port: number;
  envVars: Record<string, string>;
}

export interface DetectedStack {
  runtime: "node" | "python" | "go";
  version: string;
  entrypoint: string;
  port: number;
  databases: DetectedDB[];
  hasDockerfile: boolean;
}

const NODE_DB_PATTERNS: Array<{ packages: string[]; db: DetectedDB }> = [
  {
    packages: ["prisma", "@prisma/client", "pg", "postgres", "knex", "typeorm", "sequelize"],
    db: { type: "postgres", image: "postgres:16-alpine", port: 5432, envVars: { POSTGRES_PASSWORD: "cloudenv", POSTGRES_DB: "app" } },
  },
  {
    packages: ["redis", "ioredis", "@redis/client", "bullmq", "bull"],
    db: { type: "redis", image: "redis:7-alpine", port: 6379, envVars: {} },
  },
  {
    packages: ["mongoose", "mongodb"],
    db: { type: "mongo", image: "mongo:7", port: 27017, envVars: {} },
  },
  {
    packages: ["mysql2", "mysql"],
    db: { type: "mysql", image: "mysql:8", port: 3306, envVars: { MYSQL_ROOT_PASSWORD: "cloudenv", MYSQL_DATABASE: "app" } },
  },
];

const PYTHON_DB_PATTERNS: Array<{ packages: string[]; db: DetectedDB }> = [
  {
    packages: ["psycopg2", "psycopg2-binary", "asyncpg", "sqlalchemy"],
    db: { type: "postgres", image: "postgres:16-alpine", port: 5432, envVars: { POSTGRES_PASSWORD: "cloudenv", POSTGRES_DB: "app" } },
  },
  {
    packages: ["redis", "aioredis", "celery"],
    db: { type: "redis", image: "redis:7-alpine", port: 6379, envVars: {} },
  },
  {
    packages: ["pymongo", "motor", "mongoengine"],
    db: { type: "mongo", image: "mongo:7", port: 27017, envVars: {} },
  },
];

const GO_DB_PATTERNS: Array<{ modules: string[]; db: DetectedDB }> = [
  {
    modules: ["github.com/jackc/pgx", "github.com/lib/pq", "gorm.io/driver/postgres"],
    db: { type: "postgres", image: "postgres:16-alpine", port: 5432, envVars: { POSTGRES_PASSWORD: "cloudenv", POSTGRES_DB: "app" } },
  },
  {
    modules: ["github.com/redis/go-redis", "github.com/go-redis/redis"],
    db: { type: "redis", image: "redis:7-alpine", port: 6379, envVars: {} },
  },
];

function detectDatabases(
  deps: string[],
  patterns: Array<{ packages?: string[]; modules?: string[]; db: DetectedDB }>
): DetectedDB[] {
  const found: DetectedDB[] = [];
  const seenTypes = new Set<string>();

  for (const pattern of patterns) {
    const keys = pattern.packages || pattern.modules || [];
    const match = keys.some((k) => deps.some((d) => d === k || d.startsWith(k + "/") || d.startsWith(k + "@")));
    if (match && !seenTypes.has(pattern.db.type)) {
      found.push(pattern.db);
      seenTypes.add(pattern.db.type);
    }
  }

  return found;
}

export function detectNode(projectDir: string): DetectedStack | null {
  const pkgPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
    engines?: { node?: string };
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const version = pkg.engines?.node?.replace(/[^0-9.]/g, "").split(".")[0] || "20";
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];

  // Detect entrypoint
  let entrypoint = "node index.js";
  if (pkg.scripts?.start) {
    entrypoint = pkg.scripts.start;
  }

  // Detect port based on framework
  let port = 3000;
  if (allDeps.includes("next")) port = 3000;
  else if (allDeps.includes("nuxt")) port = 3000;
  else if (allDeps.includes("fastify")) port = 3000;
  else if (allDeps.includes("express")) port = 3000;
  else if (allDeps.includes("hono")) port = 3000;

  const databases = detectDatabases(allDeps, NODE_DB_PATTERNS);
  const hasDockerfile = fs.existsSync(path.join(projectDir, "Dockerfile"));

  return { runtime: "node", version, entrypoint, port, databases, hasDockerfile };
}

export function detectPython(projectDir: string): DetectedStack | null {
  const reqPath = path.join(projectDir, "requirements.txt");
  const pyprojectPath = path.join(projectDir, "pyproject.toml");

  if (!fs.existsSync(reqPath) && !fs.existsSync(pyprojectPath)) return null;

  let deps: string[] = [];
  if (fs.existsSync(reqPath)) {
    const content = fs.readFileSync(reqPath, "utf-8");
    deps = content
      .split("\n")
      .map((line) => line.trim().split(/[>=<\[]/)[0].toLowerCase())
      .filter(Boolean);
  }

  // Detect framework and entrypoint
  let entrypoint = "python app.py";
  let port = 8000;

  if (deps.includes("django")) {
    entrypoint = "python manage.py runserver 0.0.0.0:8000";
    port = 8000;
  } else if (deps.includes("fastapi") || deps.includes("uvicorn")) {
    entrypoint = "uvicorn main:app --host 0.0.0.0 --port 8000";
    port = 8000;
  } else if (deps.includes("flask")) {
    entrypoint = "flask run --host=0.0.0.0 --port=5000";
    port = 5000;
  }

  const databases = detectDatabases(deps, PYTHON_DB_PATTERNS);
  const hasDockerfile = fs.existsSync(path.join(projectDir, "Dockerfile"));

  return { runtime: "python", version: "3.12", entrypoint, port, databases, hasDockerfile };
}

export function detectGo(projectDir: string): DetectedStack | null {
  const goModPath = path.join(projectDir, "go.mod");
  if (!fs.existsSync(goModPath)) return null;

  const content = fs.readFileSync(goModPath, "utf-8");
  const versionMatch = content.match(/^go\s+(\d+\.\d+)/m);
  const version = versionMatch?.[1] || "1.22";

  // Extract module dependencies
  const deps: string[] = [];
  const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
  if (requireBlock) {
    for (const line of requireBlock[1].split("\n")) {
      const mod = line.trim().split(/\s/)[0];
      if (mod) deps.push(mod);
    }
  }

  const databases = detectDatabases(
    deps,
    GO_DB_PATTERNS.map((p) => ({ packages: p.modules, db: p.db }))
  );
  const hasDockerfile = fs.existsSync(path.join(projectDir, "Dockerfile"));

  return { runtime: "go", version, entrypoint: "go run .", port: 8080, databases, hasDockerfile };
}

export function detectStack(projectDir: string): DetectedStack | null {
  // Try each detector in order
  return detectNode(projectDir) || detectPython(projectDir) || detectGo(projectDir) || null;
}
