import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let tmpDir: string;

vi.mock("os", async () => {
  const actual = await vi.importActual<typeof import("os")>("os");
  return {
    ...actual,
    homedir: () => tmpDir,
  };
});

import {
  EnvRecord,
  loadEnvStore,
  saveEnv,
  removeEnv,
  findEnv,
  findEnvByBranch,
} from "../env-store";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cloudenv-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeRecord(overrides: Partial<EnvRecord> = {}): EnvRecord {
  return {
    appName: "my-app-feat-123",
    repo: "owner/repo",
    branch: "feat-123",
    url: "https://my-app-feat-123.fly.dev",
    services: [
      {
        name: "web",
        machineId: "m-abc",
        image: "registry.fly.io/my-app:latest",
        privateIp: "fdaa::1",
        isWeb: true,
      },
    ],
    createdAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

describe("env-store", () => {
  it("loadEnvStore returns [] for missing file", () => {
    expect(loadEnvStore()).toEqual([]);
  });

  it("saveEnv + loadEnvStore roundtrip", () => {
    const record = makeRecord();
    saveEnv(record);
    const stored = loadEnvStore();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(record);
  });

  it("removeEnv removes the correct record", () => {
    const r1 = makeRecord({ appName: "app-one", branch: "branch-one" });
    const r2 = makeRecord({ appName: "app-two", branch: "branch-two" });
    saveEnv(r1);
    saveEnv(r2);
    expect(loadEnvStore()).toHaveLength(2);

    removeEnv("app-one");
    const remaining = loadEnvStore();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].appName).toBe("app-two");
  });

  it("findEnv returns the correct record", () => {
    const r1 = makeRecord({ appName: "app-one" });
    const r2 = makeRecord({ appName: "app-two" });
    saveEnv(r1);
    saveEnv(r2);

    expect(findEnv("app-two")).toEqual(r2);
    expect(findEnv("nonexistent")).toBeUndefined();
  });

  it("findEnvByBranch works", () => {
    const r1 = makeRecord({ appName: "app-one", branch: "feat-a" });
    const r2 = makeRecord({ appName: "app-two", branch: "feat-b" });
    saveEnv(r1);
    saveEnv(r2);

    expect(findEnvByBranch("feat-b")).toEqual(r2);
    expect(findEnvByBranch("nonexistent")).toBeUndefined();
  });

  it("multiple records stored correctly", () => {
    const records = [
      makeRecord({ appName: "app-1", branch: "b-1" }),
      makeRecord({ appName: "app-2", branch: "b-2" }),
      makeRecord({ appName: "app-3", branch: "b-3" }),
    ];
    for (const r of records) {
      saveEnv(r);
    }
    const stored = loadEnvStore();
    expect(stored).toHaveLength(3);
    expect(stored.map((r) => r.appName)).toEqual(["app-1", "app-2", "app-3"]);
  });
});
