import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/env-store", () => ({
  findEnv: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { findEnv } from "../../lib/env-store";

const mockedFindEnv = vi.mocked(findEnv);

describe("logs command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exits with error when environment not found", async () => {
    mockedFindEnv.mockReturnValue(undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const { logsCommand } = await import("../logs");
    logsCommand.parse(["nonexistent"], { from: "user" });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("exits with error when service not found in environment", async () => {
    mockedFindEnv.mockReturnValue({
      appName: "ce-test",
      repo: "test",
      branch: "main",
      url: "https://ce-test.fly.dev",
      services: [{ name: "web", machineId: "m1", image: "img", privateIp: "10.0.0.1", isWeb: true }],
      createdAt: new Date().toISOString(),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const { logsCommand } = await import("../logs");
    vi.resetModules();
    vi.mock("../../lib/env-store", () => ({
      findEnv: vi.fn().mockReturnValue({
        appName: "ce-test",
        repo: "test",
        branch: "main",
        url: "https://ce-test.fly.dev",
        services: [{ name: "web", machineId: "m1", image: "img", privateIp: "10.0.0.1", isWeb: true }],
        createdAt: new Date().toISOString(),
      }),
    }));
    vi.mock("child_process", () => ({
      execSync: vi.fn(() => { throw new Error("not found"); }),
    }));
    const mod = await import("../logs");
    mod.logsCommand.parse(["ce-test", "nonexistent-service"], { from: "user" });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
