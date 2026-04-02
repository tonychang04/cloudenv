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
  CloudEnvConfig,
  getConfigDir,
  getConfigPath,
  loadConfig,
  saveConfig,
  hasConfig,
} from "../config";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cloudenv-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("config", () => {
  const sampleConfig: CloudEnvConfig = {
    flyApiToken: "fly-tok-abc123",
    orgSlug: "personal",
  };

  it("read/write roundtrip", () => {
    saveConfig(sampleConfig);
    const loaded = loadConfig();
    expect(loaded).toEqual(sampleConfig);
  });

  it("throws 'Not logged in' when config file is missing", () => {
    expect(() => loadConfig()).toThrowError(
      "Not logged in. Run `cloudenv login` first."
    );
  });

  it("creates parent directory if missing", () => {
    const dir = getConfigDir();
    expect(fs.existsSync(dir)).toBe(false);
    saveConfig(sampleConfig);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("hasConfig returns false when no file exists", () => {
    expect(hasConfig()).toBe(false);
  });

  it("hasConfig returns true when file exists", () => {
    saveConfig(sampleConfig);
    expect(hasConfig()).toBe(true);
  });

  it("file is written with mode 0o600", () => {
    saveConfig(sampleConfig);
    const stat = fs.statSync(getConfigPath());
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
