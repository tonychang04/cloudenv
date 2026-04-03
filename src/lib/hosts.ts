/**
 * Generate /etc/hosts content for multi-container Fly Machines.
 *
 * Maps all service names to 127.0.0.1 so docker-compose service references
 * (e.g., DATABASE_URL=postgres://db:5432) resolve correctly when all
 * containers share a network namespace.
 *
 * Fly.io also adds these entries automatically, but we inject our own
 * as a safety net to ensure consistent behavior.
 */

export function generateHostsContent(serviceNames: string[]): string {
  const lines = [
    "127.0.0.1 localhost",
    "::1 localhost",
    ...serviceNames.map((name) => `127.0.0.1 ${name}`),
    ...serviceNames.map((name) => `::1 ${name}`),
  ];
  return lines.join("\n") + "\n";
}

export function generateHostsFileBase64(serviceNames: string[]): string {
  const content = generateHostsContent(serviceNames);
  return Buffer.from(content).toString("base64");
}
