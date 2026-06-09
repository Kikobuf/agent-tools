import axios, { AxiosInstance } from "axios";

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  nodes: N8nNode[];
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  tags?: { id: string; name: string }[];
}

export interface N8nNode {
  id?: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
}

export interface N8nExecution {
  id: string;
  workflowId: string;
  finished: boolean;
  mode: string;
  startedAt: string;
  stoppedAt?: string;
  status: "success" | "error" | "running" | "waiting" | "canceled";
  data?: {
    resultData?: {
      error?: { message: string; stack?: string };
      runData?: Record<string, unknown[]>;
    };
  };
}

export interface N8nNodeType {
  name: string;
  displayName: string;
  description: string;
  version: number | number[];
  group: string[];
  icon?: string;
}

export class N8nClient {
  private client: AxiosInstance;
  private instances: Record<string, AxiosInstance> = {};
  private activeInstance: string = "default";

  constructor(baseUrl: string, apiKey: string) {
    this.client = axios.create({
      baseURL: baseUrl.replace(/\/$/, "") + "/api/v1",
      headers: {
        "X-N8N-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
    });
    this.instances["default"] = this.client;
  }

  addInstance(name: string, baseUrl: string, apiKey: string) {
    this.instances[name] = axios.create({
      baseURL: baseUrl.replace(/\/$/, "") + "/api/v1",
      headers: {
        "X-N8N-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
    });
  }

  switchInstance(name: string) {
    if (!this.instances[name]) throw new Error(`Instance "${name}" not found`);
    this.activeInstance = name;
    this.client = this.instances[name];
  }

  getActiveInstance() {
    return this.activeInstance;
  }

  listInstances() {
    return Object.keys(this.instances);
  }

  // ── Workflows ──────────────────────────────────────────────────────────────

  async listWorkflows(): Promise<N8nWorkflow[]> {
    const res = await this.client.get("/workflows");
    return res.data.data ?? res.data;
  }

  async getWorkflow(id: string): Promise<N8nWorkflow> {
    const res = await this.client.get(`/workflows/${id}`);
    return res.data;
  }

  async createWorkflow(
    name: string,
    nodes: N8nNode[],
    connections: Record<string, unknown>,
    settings?: Record<string, unknown>
  ): Promise<N8nWorkflow> {
    const res = await this.client.post("/workflows", {
      name,
      nodes,
      connections,
      settings: settings ?? { executionOrder: "v1" },
    });
    return res.data;
  }

  async updateWorkflow(
    id: string,
    patch: Partial<Pick<N8nWorkflow, "name" | "nodes" | "connections" | "settings">>
  ): Promise<N8nWorkflow> {
    const res = await this.client.patch(`/workflows/${id}`, patch);
    return res.data;
  }

  async deleteWorkflow(id: string): Promise<void> {
    await this.client.delete(`/workflows/${id}`);
  }

  async activateWorkflow(id: string): Promise<N8nWorkflow> {
    const res = await this.client.post(`/workflows/${id}/activate`);
    return res.data;
  }

  async deactivateWorkflow(id: string): Promise<N8nWorkflow> {
    const res = await this.client.post(`/workflows/${id}/deactivate`);
    return res.data;
  }

  // ── Executions ─────────────────────────────────────────────────────────────

  async listExecutions(params?: {
    workflowId?: string;
    status?: string;
    limit?: number;
    includeData?: boolean;
  }): Promise<N8nExecution[]> {
    const res = await this.client.get("/executions", { params });
    return res.data.data ?? res.data;
  }

  async getExecution(id: string, includeData = true): Promise<N8nExecution> {
    const res = await this.client.get(`/executions/${id}`, {
      params: { includeData },
    });
    return res.data;
  }

  async deleteExecution(id: string): Promise<void> {
    await this.client.delete(`/executions/${id}`);
  }

  // ── Webhook trigger ────────────────────────────────────────────────────────

  async triggerWebhook(
    webhookPath: string,
    payload: Record<string, unknown> = {},
    method: "GET" | "POST" = "POST"
  ): Promise<unknown> {
    const baseUrl = (this.client.defaults.baseURL ?? "").replace("/api/v1", "");
    const url = `${baseUrl}/webhook/${webhookPath}`;
    const res =
      method === "POST"
        ? await axios.post(url, payload)
        : await axios.get(url, { params: payload });
    return res.data;
  }

  // ── Node types ─────────────────────────────────────────────────────────────

  async listNodeTypes(): Promise<N8nNodeType[]> {
    const res = await this.client.get("/node-types");
    return res.data.data ?? res.data;
  }

  async getNodeType(nodeType: string): Promise<unknown> {
    const res = await this.client.get(`/node-types/${encodeURIComponent(nodeType)}`);
    return res.data;
  }

  // ── Tags ───────────────────────────────────────────────────────────────────

  async listTags(): Promise<{ id: string; name: string }[]> {
    const res = await this.client.get("/tags");
    return res.data.data ?? res.data;
  }

  // ── Variables ──────────────────────────────────────────────────────────────

  async listVariables(): Promise<{ id: string; key: string; value: string }[]> {
    const res = await this.client.get("/variables");
    return res.data.data ?? res.data;
  }

  // ── Credentials (read-only list) ───────────────────────────────────────────

  async listCredentials(): Promise<{ id: string; name: string; type: string }[]> {
    const res = await this.client.get("/credentials");
    return res.data.data ?? res.data;
  }
}
