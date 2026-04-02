export interface FlyClientOptions {
  token: string;
  baseUrl?: string;
}

export class FlyApiError extends Error {
  constructor(
    public status: number,
    public endpoint: string,
    public body: unknown
  ) {
    super(`Fly API error ${status} on ${endpoint}`);
    this.name = "FlyApiError";
  }
}

export interface CreateMachineRequest {
  name?: string;
  region?: string;
  config: {
    image: string;
    env?: Record<string, string>;
    guest?: { cpu_kind: string; cpus: number; memory_mb: number };
    services?: FlyService[];
    init?: { cmd?: string[] };
    restart?: { policy: string };
    metadata?: Record<string, string>;
  };
}

export interface FlyService {
  protocol: "tcp";
  internal_port: number;
  ports: Array<{ port: number; handlers: string[]; force_https?: boolean }>;
}

export interface FlyMachine {
  id: string;
  name: string;
  state: string;
  region: string;
  instance_id: string;
  private_ip: string;
  config: { image: string; env?: Record<string, string> };
  created_at: string;
}

export interface FlyApp {
  id: string;
  name: string;
  machine_count: number;
  network: string;
}

export class FlyClient {
  private token: string;
  private baseUrl: string;

  constructor(options: FlyClientOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? "https://api.machines.dev";
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }
      throw new FlyApiError(response.status, path, responseBody);
    }

    // For DELETE responses that may have no body
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async createApp(appName: string, orgSlug: string): Promise<FlyApp> {
    return this.request<FlyApp>("POST", "/v1/apps", {
      app_name: appName,
      org_slug: orgSlug,
    });
  }

  async deleteApp(appName: string): Promise<void> {
    await this.request<void>("DELETE", `/v1/apps/${appName}`);
  }

  async listApps(orgSlug: string): Promise<FlyApp[]> {
    return this.request<FlyApp[]>("GET", `/v1/apps?org_slug=${orgSlug}`);
  }

  async createMachine(
    appName: string,
    config: CreateMachineRequest
  ): Promise<FlyMachine> {
    return this.request<FlyMachine>(
      "POST",
      `/v1/apps/${appName}/machines`,
      config
    );
  }

  async listMachines(appName: string): Promise<FlyMachine[]> {
    return this.request<FlyMachine[]>(
      "GET",
      `/v1/apps/${appName}/machines`
    );
  }

  async deleteMachine(
    appName: string,
    machineId: string,
    force?: boolean
  ): Promise<void> {
    const query = force ? "?force=true" : "";
    await this.request<void>(
      "DELETE",
      `/v1/apps/${appName}/machines/${machineId}${query}`
    );
  }

  async waitForMachine(
    appName: string,
    machineId: string,
    state: string = "started",
    timeout: number = 60
  ): Promise<void> {
    await this.request<void>(
      "GET",
      `/v1/apps/${appName}/machines/${machineId}/wait?state=${state}&timeout=${timeout}`
    );
  }
}
