import { describe, it, expect, vi, beforeEach } from "vitest";

const mockListMachines = vi.fn();
const mockFindEnv = vi.fn();
const mockFindEnvByBranch = vi.fn();

vi.mock("../../lib/config", () => ({
  loadConfig: () => ({ flyApiToken: "test-token", orgSlug: "personal" }),
}));

vi.mock("../../lib/fly-client", () => ({
  FlyClient: vi.fn().mockImplementation(() => ({
    listMachines: (...args: unknown[]) => mockListMachines(...args),
  })),
}));

vi.mock("../../lib/env-store", () => ({
  findEnv: (...args: unknown[]) => mockFindEnv(...args),
  findEnvByBranch: (...args: unknown[]) => mockFindEnvByBranch(...args),
}));

vi.mock("../../lib/git", () => ({
  getBranchName: () => "main",
}));

describe("status command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows healthy status when all machines are started", async () => {
    mockFindEnv.mockReturnValue({
      appName: "ce-test-main",
      repo: "test",
      branch: "main",
      url: "https://ce-test-main.fly.dev",
      services: [
        { name: "web", machineId: "m1", image: "nginx", privateIp: "fdaa::1", isWeb: true },
        { name: "db", machineId: "m2", image: "postgres", privateIp: "fdaa::2", isWeb: false },
      ],
      createdAt: new Date().toISOString(),
    });
    mockListMachines.mockResolvedValue([
      { id: "m1", name: "web", state: "started", region: "iad", instance_id: "i1", private_ip: "fdaa::1", config: { image: "nginx" }, created_at: "" },
      { id: "m2", name: "db", state: "started", region: "iad", instance_id: "i2", private_ip: "fdaa::2", config: { image: "postgres" }, created_at: "" },
    ]);

    const { statusCommand } = await import("../status");
    await statusCommand.parseAsync(["ce-test-main"], { from: "user" });

    const output = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("ce-test-main.fly.dev");
    expect(output).toContain("web");
    expect(output).toContain("db");
  });

  it("exits with error when environment not found", async () => {
    mockFindEnv.mockReturnValue(undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    vi.resetModules();
    const mod = await import("../status");
    await mod.statusCommand.parseAsync(["nonexistent"], { from: "user" });

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("outputs JSON when --json flag is set", async () => {
    mockFindEnv.mockReturnValue({
      appName: "ce-test-main",
      repo: "test",
      branch: "main",
      url: "https://ce-test-main.fly.dev",
      services: [
        { name: "web", machineId: "m1", image: "nginx", privateIp: "fdaa::1", isWeb: true },
      ],
      createdAt: "2026-04-01T00:00:00Z",
    });
    mockListMachines.mockResolvedValue([
      { id: "m1", name: "web", state: "started", region: "iad", instance_id: "i1", private_ip: "fdaa::1", config: { image: "nginx" }, created_at: "" },
    ]);

    vi.resetModules();
    const mod = await import("../status");
    await mod.statusCommand.parseAsync(["ce-test-main", "--json"], { from: "user" });

    const jsonCall = vi.mocked(console.log).mock.calls.find((call) => {
      try {
        const parsed = JSON.parse(call[0] as string);
        return parsed.appName === "ce-test-main";
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeTruthy();
    const parsed = JSON.parse(jsonCall![0] as string);
    expect(parsed.healthy).toBe(true);
    expect(parsed.services).toHaveLength(1);
  });
});
