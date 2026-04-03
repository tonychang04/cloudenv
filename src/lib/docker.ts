import { execSync } from "child_process";

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

export function buildAndPush(
  serviceName: string,
  buildContext: string,
  dockerfile: string | undefined,
  cacheAppName: string,
  flyToken: string,
  target?: string
): BuildResult {
  // Push to the cache app's registry so layers persist across env deploys
  // Format: registry.fly.io/{cache-app}:{service-name}
  const imageRef = `registry.fly.io/${cacheAppName}:${serviceName}`;

  // Build the image
  const dockerfileArgs = dockerfile ? `-f ${dockerfile}` : "";
  const targetArgs = target ? `--target ${target}` : "";
  try {
    execSync(`docker build -t ${imageRef} ${dockerfileArgs} ${targetArgs} ${buildContext}`, {
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error(
      `Docker build failed for service "${serviceName}": ${error instanceof Error ? error.message : error}`
    );
  }

  // Login to Fly registry
  try {
    execSync(`docker login registry.fly.io -u x --password-stdin`, {
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
    execSync(`docker push ${imageRef}`, {
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error(
      `Docker push failed for "${imageRef}": ${error instanceof Error ? error.message : error}`
    );
  }

  return { imageRef };
}
