import { execSync, execFileSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface BuildResult {
  imageRef: string;
}

export function checkDockerAvailable(): boolean {
  try {
    execSync("docker --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function checkFlyctlAvailable(): boolean {
  try {
    execSync("flyctl version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function buildAndPush(
  serviceName: string,
  buildContext: string,
  dockerfile: string | undefined,
  cacheAppName: string,
  flyToken: string,
  target?: string,
  buildArgs?: Record<string, string>
): BuildResult {
  const imageRef = `registry.fly.io/${cacheAppName}:${serviceName}`;

  // Prefer flyctl remote builder (native amd64, no QEMU on Apple Silicon)
  // Note: must NOT use --build-only (doesn't push manifest to registry)
  if (checkFlyctlAvailable()) {
    return buildWithFlyctl(serviceName, buildContext, dockerfile, cacheAppName, flyToken, target, buildArgs);
  }
  return buildWithDocker(serviceName, buildContext, dockerfile, cacheAppName, flyToken, target, buildArgs);
}

export async function buildAndPushAsync(
  serviceName: string,
  buildContext: string,
  dockerfile: string | undefined,
  cacheAppName: string,
  flyToken: string,
  target?: string,
  buildArgs?: Record<string, string>
): Promise<BuildResult> {
  const imageRef = `registry.fly.io/${cacheAppName}:${serviceName}`;

  if (checkFlyctlAvailable()) {
    return buildWithFlyctlAsync(serviceName, buildContext, dockerfile, cacheAppName, flyToken, target, buildArgs);
  }
  // Local Docker build — sync wrapper (can't parallelize execFileSync)
  return new Promise((resolve, reject) => {
    try {
      resolve(buildAndPush(serviceName, buildContext, dockerfile, cacheAppName, flyToken, target, buildArgs));
    } catch (err) {
      reject(err);
    }
  });
}

function buildWithFlyctlAsync(
  serviceName: string,
  buildContext: string,
  dockerfile: string | undefined,
  cacheAppName: string,
  flyToken: string,
  target?: string,
  buildArgs?: Record<string, string>
): Promise<BuildResult> {
  const imageRef = `registry.fly.io/${cacheAppName}:${serviceName}`;

  // Do NOT use --build-only (it doesn't push the manifest to registry).
  // Use --ha=false to skip standby machines. We destroy created machines after.
  const args = [
    "deploy", "--app", cacheAppName,
    "--remote-only", "--ha=false",
    "--image-label", serviceName,
  ];
  if (dockerfile) args.push("--dockerfile", dockerfile);
  if (target) args.push("--build-target", target);
  if (buildArgs) {
    for (const [key, value] of Object.entries(buildArgs)) {
      args.push("--build-arg", `${key}=${value}`);
    }
  }

  const buildDir = buildContext === "." ? process.cwd() : path.resolve(buildContext);

  return new Promise((resolve, reject) => {
    const child = spawn("flyctl", args, {
      stdio: "inherit",
      cwd: buildDir,
      env: { ...process.env, FLY_API_TOKEN: flyToken },
    });

    child.on("close", async (code) => {
      if (code === 0) {
        // Clean up machines flyctl created on the cache app
        try {
          execFileSync("flyctl", ["machines", "list", "--app", cacheAppName, "--json"], {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, FLY_API_TOKEN: flyToken },
          });
          // Destroy any machines on the cache app (we only want the registry images)
          execFileSync("flyctl", ["machines", "destroy", "--app", cacheAppName, "--force", "--select"], {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, FLY_API_TOKEN: flyToken },
          });
        } catch {
          // Best effort cleanup — machines on cache app are stopped and cheap
        }
        resolve({ imageRef });
      } else {
        reject(new Error(`Remote build failed for "${serviceName}" (exit code ${code})`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Remote build failed for "${serviceName}": ${err.message}`));
    });
  });
}

function buildWithFlyctl(
  serviceName: string,
  buildContext: string,
  dockerfile: string | undefined,
  cacheAppName: string,
  flyToken: string,
  target?: string,
  buildArgs?: Record<string, string>
): BuildResult {
  const imageRef = `registry.fly.io/${cacheAppName}:${serviceName}`;

  const args = [
    "deploy", "--app", cacheAppName,
    "--remote-only", "--ha=false",
    "--image-label", serviceName,
  ];
  if (dockerfile) args.push("--dockerfile", dockerfile);
  if (target) args.push("--build-target", target);
  if (buildArgs) {
    for (const [key, value] of Object.entries(buildArgs)) {
      args.push("--build-arg", `${key}=${value}`);
    }
  }

  // fly.toml is managed by up.ts (written once before parallel builds)
  const buildDir = buildContext === "." ? process.cwd() : path.resolve(buildContext);

  try {
    execFileSync("flyctl", args, {
      stdio: "inherit",
      cwd: buildDir,
      env: { ...process.env, FLY_API_TOKEN: flyToken },
    });
  } catch (error) {
    throw new Error(
      `Remote build failed for service "${serviceName}": ${error instanceof Error ? error.message : error}`
    );
  }

  // Clean up machines flyctl created on the cache app
  try {
    const machinesJson = execFileSync("flyctl", ["machines", "list", "--app", cacheAppName, "--json"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, FLY_API_TOKEN: flyToken },
      encoding: "utf-8",
    });
    const machines = JSON.parse(machinesJson) as Array<{ id: string }>;
    for (const m of machines) {
      try {
        execFileSync("flyctl", ["machines", "destroy", m.id, "--app", cacheAppName, "--force"], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, FLY_API_TOKEN: flyToken },
        });
      } catch { /* best effort */ }
    }
  } catch { /* best effort */ }

  return { imageRef };
}

function buildWithDocker(
  serviceName: string,
  buildContext: string,
  dockerfile: string | undefined,
  cacheAppName: string,
  flyToken: string,
  target?: string,
  dockerBuildArgs?: Record<string, string>
): BuildResult {
  const imageRef = `registry.fly.io/${cacheAppName}:${serviceName}`;

  // Build locally for amd64 (Fly runs x86_64)
  const buildArgs = ["build", "--platform", "linux/amd64", "-t", imageRef];
  if (dockerfile) buildArgs.push("-f", dockerfile);
  if (dockerBuildArgs) {
    for (const [key, value] of Object.entries(dockerBuildArgs)) {
      buildArgs.push("--build-arg", `${key}=${value}`);
    }
  }
  if (target) buildArgs.push("--target", target);
  buildArgs.push(buildContext);
  try {
    execFileSync("docker", buildArgs, { stdio: "inherit" });
  } catch (error) {
    throw new Error(
      `Docker build failed for service "${serviceName}": ${error instanceof Error ? error.message : error}`
    );
  }

  // Login to Fly registry
  try {
    execSync("docker login registry.fly.io -u x --password-stdin", {
      input: flyToken,
      stdio: ["pipe", "inherit", "inherit"],
    });
  } catch (error) {
    throw new Error(
      `Docker login to Fly registry failed: ${error instanceof Error ? error.message : error}`
    );
  }

  // Push the image
  try {
    execFileSync("docker", ["push", imageRef], { stdio: "inherit" });
  } catch (error) {
    throw new Error(
      `Docker push failed for "${imageRef}": ${error instanceof Error ? error.message : error}`
    );
  }

  return { imageRef };
}
