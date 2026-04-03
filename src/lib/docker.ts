import { execSync, execFileSync } from "child_process";

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
  target?: string
): BuildResult {
  const imageRef = `registry.fly.io/${cacheAppName}:${serviceName}`;

  // Prefer flyctl remote builder (builds on Fly's amd64 hardware, no QEMU)
  // Falls back to local Docker if flyctl isn't available
  if (checkFlyctlAvailable()) {
    return buildWithFlyctl(serviceName, buildContext, dockerfile, cacheAppName, flyToken, target);
  }

  return buildWithDocker(serviceName, buildContext, dockerfile, cacheAppName, flyToken, target);
}

function buildWithFlyctl(
  serviceName: string,
  buildContext: string,
  dockerfile: string | undefined,
  cacheAppName: string,
  flyToken: string,
  target?: string
): BuildResult {
  const imageRef = `registry.fly.io/${cacheAppName}:${serviceName}`;

  // flyctl deploy --build-only --remote-only builds on Fly's amd64 machines
  // and pushes to the registry in one step. No local Docker needed for the build.
  // We use --image-label to tag the image in the registry.
  const args = [
    "deploy", "--app", cacheAppName,
    "--build-only", "--remote-only",
    "--image-label", serviceName,
  ];
  if (dockerfile) args.push("--dockerfile", dockerfile);
  if (target) args.push("--build-target", target);

  try {
    execFileSync("flyctl", args, {
      stdio: "inherit",
      cwd: buildContext === "." ? undefined : buildContext,
      env: { ...process.env, FLY_API_TOKEN: flyToken },
    });
  } catch (error) {
    throw new Error(
      `Remote build failed for service "${serviceName}": ${error instanceof Error ? error.message : error}`
    );
  }

  return { imageRef };
}

function buildWithDocker(
  serviceName: string,
  buildContext: string,
  dockerfile: string | undefined,
  cacheAppName: string,
  flyToken: string,
  target?: string
): BuildResult {
  const imageRef = `registry.fly.io/${cacheAppName}:${serviceName}`;

  // Build locally for amd64 (Fly runs x86_64)
  const buildArgs = ["build", "--platform", "linux/amd64", "-t", imageRef];
  if (dockerfile) buildArgs.push("-f", dockerfile);
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
