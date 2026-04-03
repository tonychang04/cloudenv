import { describe, it, expect } from "vitest";
import { preflightCheck } from "../compose";

describe("preflightCheck", () => {
  it("returns no issues for a clean compose file", () => {
    const issues = preflightCheck(`
services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
  db:
    image: postgres:16
`);
    expect(issues).toHaveLength(0);
  });

  it("warns about local bind mounts", () => {
    const issues = preflightCheck(`
services:
  app:
    image: myapp
    volumes:
      - ./src:/app/src
      - ./config.yml:/app/config.yml
`);
    const warnings = issues.filter((i) => i.level === "warning");
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    expect(warnings[0].message).toContain("Bind mount");
    expect(warnings[0].message).toContain("./src");
  });

  it("warns about dev build target", () => {
    const issues = preflightCheck(`
services:
  app:
    build:
      context: .
      target: dev
    ports:
      - "3000:3000"
`);
    const warnings = issues.filter((i) => i.level === "warning");
    expect(warnings.some((w) => w.message.includes("dev"))).toBe(true);
  });

  it("errors on docker.sock mount", () => {
    const issues = preflightCheck(`
services:
  monitor:
    image: monitoring-tool
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
`);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("docker.sock");
  });

  it("errors on service with no image and no build", () => {
    const issues = preflightCheck(`
services:
  broken:
    ports:
      - "3000:3000"
`);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("No 'image' or 'build'");
  });

  it("ignores named volumes (no warning)", () => {
    const issues = preflightCheck(`
services:
  db:
    image: postgres:16
    volumes:
      - postgres-data:/var/lib/postgresql/data
`);
    expect(issues).toHaveLength(0);
  });
});
