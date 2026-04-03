import { describe, it, expect } from "vitest";
import { generateHostsContent, generateHostsFileBase64 } from "../hosts";

describe("generateHostsContent", () => {
  it("includes localhost entries and all service names", () => {
    const result = generateHostsContent(["web", "db", "redis"]);
    expect(result).toContain("127.0.0.1 localhost");
    expect(result).toContain("::1 localhost");
    expect(result).toContain("127.0.0.1 web");
    expect(result).toContain("127.0.0.1 db");
    expect(result).toContain("127.0.0.1 redis");
    expect(result).toContain("::1 web");
    expect(result).toContain("::1 db");
    expect(result).toContain("::1 redis");
  });

  it("works with a single service", () => {
    const result = generateHostsContent(["app"]);
    expect(result).toContain("127.0.0.1 localhost");
    expect(result).toContain("127.0.0.1 app");
    expect(result).toContain("::1 app");
  });

  it("ends with a newline", () => {
    const result = generateHostsContent(["web"]);
    expect(result.endsWith("\n")).toBe(true);
  });
});

describe("generateHostsFileBase64", () => {
  it("returns valid base64 that decodes to correct hosts content", () => {
    const b64 = generateHostsFileBase64(["web", "db"]);
    const decoded = Buffer.from(b64, "base64").toString("utf-8");
    expect(decoded).toContain("127.0.0.1 web");
    expect(decoded).toContain("127.0.0.1 db");
    expect(decoded).toContain("127.0.0.1 localhost");
  });
});
