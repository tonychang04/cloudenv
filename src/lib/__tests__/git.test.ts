import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "child_process";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

describe("getBranchName", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns current git branch", async () => {
    mockedExecSync.mockReturnValue("feature/my-branch\n");
    const { getBranchName } = await import("../git");
    expect(getBranchName()).toBe("feature/my-branch");
  });

  it("returns 'default' when not in a git repo", async () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    const { getBranchName } = await import("../git");
    expect(getBranchName()).toBe("default");
  });
});

describe("getRepoName", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("extracts repo name from git remote URL", async () => {
    mockedExecSync.mockReturnValue("https://github.com/user/my-repo.git\n");
    const { getRepoName } = await import("../git");
    expect(getRepoName()).toBe("my-repo");
  });

  it("extracts repo name from SSH URL", async () => {
    mockedExecSync.mockReturnValue("git@github.com:user/my-repo.git\n");
    const { getRepoName } = await import("../git");
    expect(getRepoName()).toBe("my-repo");
  });

  it("falls back to directory name when no remote", async () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("no remote");
    });
    const { getRepoName } = await import("../git");
    const result = getRepoName();
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
});
