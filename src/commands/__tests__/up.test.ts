import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateApp = vi.fn();
const mockCreateMachine = vi.fn();
const mockWaitForMachine = vi.fn();
const mockDeleteMachine = vi.fn();
const mockDeleteApp = vi.fn();
const mockAllocateIpAddress = vi.fn();
const mockSaveEnv = vi.fn();
const mockFindEnv = vi.fn();
const mockFindEnvByBranch = vi.fn();

vi.mock("../../lib/config", () => ({
  loadConfig: () => ({ flyApiToken: "test-token", orgSlug: "personal" }),
}));

vi.mock("../../lib/git", () => ({
  getBranchName: () => "main",
  getRepoName: () => "test-repo",
}));

vi.mock("../../lib/env-store", () => ({
  findEnv: (...args: unknown[]) => mockFindEnv(...args),
  findEnvByBranch: (...args: unknown[]) => mockFindEnvByBranch(...args),
  saveEnv: (...args: unknown[]) => mockSaveEnv(...args),
}));

vi.mock("../../lib/docker", () => ({
  checkDockerAvailable: () => true,
  buildAndPush: () => ({ imageRef: "registry.fly.io/app/web:latest" }),
}));

vi.mock("../../lib/fly-client", () => {
  class FlyApiError extends Error {
    status: number;
    endpoint: string;
    body: unknown;
    constructor(status: number, endpoint: string, body: unknown) {
      super(`Fly API error ${status} on ${endpoint}`);
      this.name = "FlyApiError";
      this.status = status;
      this.endpoint = endpoint;
      this.body = body;
    }
  }
  return {
    FlyClient: vi.fn().mockImplementation(() => ({
      createApp: (...args: unknown[]) => mockCreateApp(...args),
      createMachine: (...args: unknown[]) => mockCreateMachine(...args),
      waitForMachine: (...args: unknown[]) => mockWaitForMachine(...args),
      deleteMachine: (...args: unknown[]) => mockDeleteMachine(...args),
      deleteApp: (...args: unknown[]) => mockDeleteApp(...args),
      allocateIpAddress: (...args: unknown[]) => mockAllocateIpAddress(...args),
    })),
    FlyApiError,
  };
});

vi.mock("../../lib/compose", () => ({
  parseComposeFile: () => ({
    services: [
      {
        name: "web",
        image: "nginx:alpine",
        ports: [{ host: 80, container: 80 }],
        environment: {},
        dependsOn: [],
      },
    ],
    webService: {
      name: "web",
      image: "nginx:alpine",
      ports: [{ host: 80, container: 80 }],
      environment: {},
      dependsOn: [],
    },
    internalServices: [],
  }),
  generateAppName: () => "ce-test-repo-main",
  toMultiContainerConfig: () => ({
    region: "iad",
    config: {
      image: "nginx:alpine",
      guest: { cpu_kind: "shared", cpus: 2, memory_mb: 2048 },
      restart: { policy: "on-failure" },
      metadata: { cloudenv: "true" },
      containers: [{ name: "web", image: "nginx:alpine", files: [] }],
      services: [{ protocol: "tcp", internal_port: 80, ports: [{ port: 80, handlers: ["http"] }, { port: 443, handlers: ["tls", "http"] }] }],
    },
  }),
  detectPortConflicts: () => {},
}));

describe("up command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockFindEnv.mockReturnValue(undefined);
    mockFindEnvByBranch.mockReturnValue(undefined);
    mockCreateApp.mockResolvedValue({ id: "app1", name: "ce-test-repo-main", machine_count: 0, network: "default" });
    mockCreateMachine.mockResolvedValue({
      id: "mach1", name: "web", state: "started", region: "iad",
      instance_id: "inst1", private_ip: "fdaa::1",
      config: { image: "nginx" }, created_at: new Date().toISOString(),
    });
    mockWaitForMachine.mockResolvedValue(undefined);
    mockDeleteMachine.mockResolvedValue(undefined);
    mockDeleteApp.mockResolvedValue(undefined);
    mockAllocateIpAddress.mockResolvedValue({ id: "ip1", address: "2a09::1", type: "v6" });
  });

  it("creates Fly app and machine for a single-service compose", async () => {
    const { upCommand } = await import("../up");
    await upCommand.parseAsync(["-f", "docker-compose.yml"], { from: "user" });

    expect(mockCreateApp).toHaveBeenCalledWith("ce-test-repo-main", "personal");
    expect(mockCreateMachine).toHaveBeenCalledTimes(1);
    expect(mockWaitForMachine).toHaveBeenCalledTimes(1);
    expect(mockSaveEnv).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: "ce-test-repo-main",
        url: "https://ce-test-repo-main.fly.dev",
      })
    );
  });

  it("rejects when environment already exists for branch", async () => {
    mockFindEnvByBranch.mockReturnValue({
      appName: "ce-test-repo-main",
      repo: "test-repo",
      branch: "main",
      url: "https://ce-test-repo-main.fly.dev",
      services: [],
      createdAt: new Date().toISOString(),
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    vi.resetModules();
    const mod = await import("../up");
    await mod.upCommand.parseAsync(["-f", "docker-compose.yml"], { from: "user" });

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorOutput = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join("\n");
    expect(errorOutput).toContain("already exists");
    exitSpy.mockRestore();
  });

  it("retries with random suffix on 422 name collision", async () => {
    const { FlyApiError } = await import("../../lib/fly-client");
    mockCreateApp
      .mockRejectedValueOnce(new FlyApiError(422, "/v1/apps", { error: "name taken" }))
      .mockResolvedValueOnce({ id: "app2", name: "ce-test-repo-main-x1y2", machine_count: 0, network: "default" });

    vi.resetModules();
    const mod = await import("../up");
    await mod.upCommand.parseAsync(["-f", "docker-compose.yml"], { from: "user" });

    expect(mockCreateApp).toHaveBeenCalledTimes(2);
  });

  it("performs atomic cleanup on machine creation failure", async () => {
    mockCreateMachine.mockRejectedValue(new Error("machine start failed"));
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    vi.resetModules();
    const mod = await import("../up");
    await mod.upCommand.parseAsync(["-f", "docker-compose.yml"], { from: "user" });

    expect(mockDeleteApp).toHaveBeenCalledWith("ce-test-repo-main");
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
