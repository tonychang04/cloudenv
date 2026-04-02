import { describe, it, expect, vi, beforeEach } from "vitest";
import { FlyClient, FlyApiError } from "../fly-client";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function emptyResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(null),
    text: () => Promise.resolve(""),
  };
}

describe("FlyClient", () => {
  let client: FlyClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new FlyClient({ token: "test-token" });
  });

  describe("createApp", () => {
    it("sends correct method, path, headers, and body", async () => {
      const app = { id: "app1", name: "my-app", machine_count: 0, network: "default" };
      mockFetch.mockResolvedValueOnce(jsonResponse(app));

      const result = await client.createApp("my-app", "personal");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.machines.dev/v1/apps",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ app_name: "my-app", org_slug: "personal" }),
        })
      );
      expect(result).toEqual(app);
    });
  });

  describe("deleteApp", () => {
    it("sends DELETE to correct path", async () => {
      mockFetch.mockResolvedValueOnce(emptyResponse());

      await client.deleteApp("my-app");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.machines.dev/v1/apps/my-app",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  describe("listApps", () => {
    it("parses response correctly", async () => {
      const apps = [
        { id: "app1", name: "app-one", machine_count: 2, network: "default" },
        { id: "app2", name: "app-two", machine_count: 0, network: "default" },
      ];
      mockFetch.mockResolvedValueOnce(jsonResponse(apps));

      const result = await client.listApps("personal");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.machines.dev/v1/apps?org_slug=personal",
        expect.objectContaining({ method: "GET" })
      );
      expect(result).toEqual(apps);
    });
  });

  describe("createMachine", () => {
    it("sends correct config", async () => {
      const machine = {
        id: "m1",
        name: "web",
        state: "started",
        region: "iad",
        instance_id: "i1",
        private_ip: "10.0.0.1",
        config: { image: "nginx:latest" },
        created_at: "2024-01-01T00:00:00Z",
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(machine));

      const config = {
        name: "web",
        region: "iad",
        config: {
          image: "nginx:latest",
          guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
        },
      };
      const result = await client.createMachine("my-app", config);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.machines.dev/v1/apps/my-app/machines",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(config),
        })
      );
      expect(result).toEqual(machine);
    });
  });

  describe("listMachines", () => {
    it("returns parsed array", async () => {
      const machines = [
        {
          id: "m1",
          name: "web",
          state: "started",
          region: "iad",
          instance_id: "i1",
          private_ip: "10.0.0.1",
          config: { image: "nginx:latest" },
          created_at: "2024-01-01T00:00:00Z",
        },
      ];
      mockFetch.mockResolvedValueOnce(jsonResponse(machines));

      const result = await client.listMachines("my-app");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.machines.dev/v1/apps/my-app/machines",
        expect.objectContaining({ method: "GET" })
      );
      expect(result).toEqual(machines);
    });
  });

  describe("deleteMachine", () => {
    it("with force=true adds query param", async () => {
      mockFetch.mockResolvedValueOnce(emptyResponse());

      await client.deleteMachine("my-app", "m1", true);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.machines.dev/v1/apps/my-app/machines/m1?force=true",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("waitForMachine", () => {
    it("calls correct endpoint with state and timeout params", async () => {
      mockFetch.mockResolvedValueOnce(emptyResponse());

      await client.waitForMachine("my-app", "m1", "stopped", 30);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.machines.dev/v1/apps/my-app/machines/m1/wait?state=stopped&timeout=30",
        expect.objectContaining({ method: "GET" })
      );
    });
  });

  describe("error handling", () => {
    it("throws FlyApiError on 401", async () => {
      const errorBody = { error: "unauthorized" };
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve(errorBody),
        text: () => Promise.resolve(JSON.stringify(errorBody)),
      });

      try {
        await client.listApps("personal");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(FlyApiError);
        expect((err as FlyApiError).status).toBe(401);
        expect((err as FlyApiError).endpoint).toBe("/v1/apps?org_slug=personal");
        expect((err as FlyApiError).body).toEqual(errorBody);
      }
    });

    it("throws FlyApiError on 422", async () => {
      const errorBody = { error: "validation failed" };
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: () => Promise.resolve(errorBody),
        text: () => Promise.resolve(JSON.stringify(errorBody)),
      });

      await expect(client.createApp("bad", "org")).rejects.toThrow(FlyApiError);
    });

    it("throws FlyApiError on 500", async () => {
      const errorBody = { error: "internal server error" };
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve(errorBody),
        text: () => Promise.resolve(JSON.stringify(errorBody)),
      });

      await expect(client.listMachines("my-app")).rejects.toThrow(FlyApiError);
    });
  });
});
