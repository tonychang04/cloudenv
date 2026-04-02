import { describe, it, expect, vi, beforeEach } from "vitest";

const mockListMachines = vi.fn();
const mockDeleteMachine = vi.fn();
const mockDeleteApp = vi.fn();
const mockFindEnv = vi.fn();
const mockFindEnvByBranch = vi.fn();
const mockRemoveEnv = vi.fn();

vi.mock("../../lib/config", () => ({
  loadConfig: () => ({ flyApiToken: "test-token", orgSlug: "personal" }),
}));

vi.mock("../../lib/fly-client", () => ({
  FlyClient: vi.fn().mockImplementation(() => ({
    listMachines: (...args: unknown[]) => mockListMachines(...args),
    deleteMachine: (...args: unknown[]) => mockDeleteMachine(...args),
    deleteApp: (...args: unknown[]) => mockDeleteApp(...args),
  })),
}));

vi.mock("../../lib/env-store", () => ({
  findEnv: (...args: unknown[]) => mockFindEnv(...args),
  findEnvByBranch: (...args: unknown[]) => mockFindEnvByBranch(...args),
  removeEnv: (...args: unknown[]) => mockRemoveEnv(...args),
}));

vi.mock("../../lib/git", () => ({
  getBranchName: () => "main",
}));

describe("down command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockListMachines.mockResolvedValue([
      { id: "m1", name: "web", state: "started", region: "iad", instance_id: "i1", private_ip: "10.0.0.1", config: { image: "nginx" }, created_at: "" },
    ]);
    mockDeleteMachine.mockResolvedValue(undefined);
    mockDeleteApp.mockResolvedValue(undefined);
  });

  it("destroys machines and app with --force flag", async () => {
    mockFindEnv.mockReturnValue({
      appName: "ce-test-main",
      repo: "test",
      branch: "main",
      url: "https://ce-test-main.fly.dev",
      services: [{ name: "web", machineId: "m1", image: "img", privateIp: "10.0.0.1", isWeb: true }],
      createdAt: new Date().toISOString(),
    });

    const { downCommand } = await import("../down");
    await downCommand.parseAsync(["ce-test-main", "--force"], { from: "user" });

    expect(mockListMachines).toHaveBeenCalledWith("ce-test-main");
    expect(mockDeleteMachine).toHaveBeenCalledWith("ce-test-main", "m1", true);
    expect(mockDeleteApp).toHaveBeenCalledWith("ce-test-main");
    expect(mockRemoveEnv).toHaveBeenCalledWith("ce-test-main");
  });

  it("exits with error when no env found for branch and no name given", async () => {
    mockFindEnvByBranch.mockReturnValue(undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    vi.resetModules();
    const mod = await import("../down");
    await mod.downCommand.parseAsync(["--force"], { from: "user" });

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("still removes from local store even when Fly API fails", async () => {
    mockFindEnv.mockReturnValue({
      appName: "ce-test-main",
      repo: "test",
      branch: "main",
      url: "https://ce-test-main.fly.dev",
      services: [],
      createdAt: new Date().toISOString(),
    });
    mockListMachines.mockRejectedValue(new Error("API down"));
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    vi.resetModules();
    const mod = await import("../down");
    await mod.downCommand.parseAsync(["ce-test-main", "--force"], { from: "user" });

    expect(mockRemoveEnv).toHaveBeenCalledWith("ce-test-main");
    exitSpy.mockRestore();
  });
});
