import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLoadEnvStore = vi.fn();

vi.mock("../../lib/env-store", () => ({
  loadEnvStore: (...args: unknown[]) => mockLoadEnvStore(...args),
}));

describe("list command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("shows 'No environments running' when store is empty", async () => {
    mockLoadEnvStore.mockReturnValue([]);

    const { listCommand } = await import("../list");
    listCommand.parse([], { from: "user" });

    expect(vi.mocked(console.log)).toHaveBeenCalledWith(expect.stringContaining("No environments"));
  });

  it("outputs JSON when --json flag is set", async () => {
    const envs = [
      {
        appName: "ce-test-main",
        repo: "test",
        branch: "main",
        url: "https://ce-test-main.fly.dev",
        services: [{ name: "web", machineId: "m1", image: "img", privateIp: "10.0.0.1", isWeb: true }],
        createdAt: new Date().toISOString(),
      },
    ];
    mockLoadEnvStore.mockReturnValue(envs);

    vi.resetModules();
    const mod = await import("../list");
    mod.listCommand.parse(["--json"], { from: "user" });

    const jsonCall = vi.mocked(console.log).mock.calls.find((call) => {
      try {
        JSON.parse(call[0] as string);
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeTruthy();
  });

  it("shows table with environment details when envs exist", async () => {
    const envs = [
      {
        appName: "ce-test-main",
        repo: "test",
        branch: "main",
        url: "https://ce-test-main.fly.dev",
        services: [{ name: "web", machineId: "m1", image: "img", privateIp: "10.0.0.1", isWeb: true }],
        createdAt: new Date().toISOString(),
      },
    ];
    mockLoadEnvStore.mockReturnValue(envs);

    vi.resetModules();
    const mod = await import("../list");
    mod.listCommand.parse([], { from: "user" });

    const output = vi.mocked(console.log).mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("ce-test-main");
    expect(output).toContain("main");
  });
});
