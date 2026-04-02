import { describe, it, expect, vi } from "vitest";
import { execSync } from "child_process";
import { checkDockerAvailable } from "../docker";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

describe("checkDockerAvailable", () => {
  it("returns true when docker is available", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("Docker version 24.0.0"));

    expect(checkDockerAvailable()).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith("docker --version", {
      stdio: "pipe",
    });
  });

  it("returns false when docker command fails", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("command not found: docker");
    });

    expect(checkDockerAvailable()).toBe(false);
  });
});
