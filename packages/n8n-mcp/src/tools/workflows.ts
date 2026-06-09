import { N8nClient } from "../n8nClient.js";

export function registerWorkflowTools(server: any, getClient: () => N8nClient) {
  // ── list_workflows ─────────────────────────────────────────────────────────
  server.tool(
    "list_workflows",
    "List all workflows in n8n. Returns id, name, active status, and last updated time.",
    {},
    async () => {
      const workflows = await getClient().listWorkflows();
      const summary = workflows.map((w) => ({
        id: w.id,
        name: w.name,
        active: w.active,
        updatedAt: w.updatedAt,
        tags: w.tags?.map((t) => t.name) ?? [],
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  // ── get_workflow ───────────────────────────────────────────────────────────
  server.tool(
    "get_workflow",
    "Get the full definition of a workflow by ID, including all nodes and connections.",
    { id: { type: "string", description: "Workflow ID" } },
    async ({ id }: { id: string }) => {
      const wf = await getClient().getWorkflow(id);
      return {
        content: [{ type: "text", text: JSON.stringify(wf, null, 2) }],
      };
    }
  );

  // ── explain_workflow ───────────────────────────────────────────────────────
  server.tool(
    "explain_workflow",
    "Get a plain-English explanation of what a workflow does by reading its node structure.",
    { id: { type: "string", description: "Workflow ID to explain" } },
    async ({ id }: { id: string }) => {
      const wf = await getClient().getWorkflow(id);
      const nodeList = wf.nodes
        .map((n) => `  - ${n.name} (${n.type})`)
        .join("\n");
      const summary = `Workflow: "${wf.name}" (ID: ${wf.id})
Status: ${wf.active ? "ACTIVE" : "INACTIVE"}
Nodes (${wf.nodes.length}):
${nodeList}

Full node details and connections for analysis:
${JSON.stringify({ nodes: wf.nodes, connections: wf.connections }, null, 2)}`;
      return {
        content: [{ type: "text", text: summary }],
      };
    }
  );

  // ── create_workflow ────────────────────────────────────────────────────────
  server.tool(
    "create_workflow",
    `Create a new workflow in n8n from a node/connection definition.
Nodes must have: name, type, typeVersion, position [x,y], parameters.
Use get_node_schema to get exact parameter shapes before creating.
Common node types: n8n-nodes-base.webhook, n8n-nodes-base.httpRequest,
n8n-nodes-base.slack, n8n-nodes-base.gmail, n8n-nodes-base.supabase,
n8n-nodes-base.set, n8n-nodes-base.if, n8n-nodes-base.code`,
    {
      name: { type: "string", description: "Workflow name" },
      nodes: {
        type: "array",
        description: "Array of node objects",
        items: { type: "object" },
      },
      connections: {
        type: "object",
        description: "Connection map between nodes",
      },
      activate: {
        type: "boolean",
        description: "Whether to activate immediately after creating (default false)",
      },
      dry_run: {
        type: "boolean",
        description: "If true, describe what would be created without actually creating it",
      },
    },
    async ({
      name,
      nodes,
      connections,
      activate = false,
      dry_run = false,
    }: {
      name: string;
      nodes: any[];
      connections: Record<string, unknown>;
      activate?: boolean;
      dry_run?: boolean;
    }) => {
      if (dry_run) {
        const nodeList = nodes.map((n) => `  - ${n.name} (${n.type})`).join("\n");
        return {
          content: [
            {
              type: "text",
              text: `DRY RUN — Workflow would be created with:\n\nName: "${name}"\nNodes (${nodes.length}):\n${nodeList}\n\nActivate on create: ${activate}\n\nNo changes made. Call again with dry_run: false to create.`,
            },
          ],
        };
      }

      const wf = await getClient().createWorkflow(name, nodes, connections);
      let result = `Created workflow "${wf.name}" with ID: ${wf.id}`;

      if (activate) {
        await getClient().activateWorkflow(wf.id);
        result += "\nWorkflow is now ACTIVE.";
      } else {
        result += "\nWorkflow is INACTIVE. Call activate_workflow to enable it.";
      }

      return { content: [{ type: "text", text: result }] };
    }
  );

  // ── update_workflow ────────────────────────────────────────────────────────
  server.tool(
    "update_workflow",
    "Update an existing workflow's name, nodes, or connections.",
    {
      id: { type: "string", description: "Workflow ID to update" },
      name: { type: "string", description: "New name (optional)" },
      nodes: { type: "array", description: "Replacement nodes array (optional)", items: { type: "object" } },
      connections: { type: "object", description: "Replacement connections (optional)" },
    },
    async ({
      id,
      name,
      nodes,
      connections,
    }: {
      id: string;
      name?: string;
      nodes?: any[];
      connections?: Record<string, unknown>;
    }) => {
      const patch: any = {};
      if (name) patch.name = name;
      if (nodes) patch.nodes = nodes;
      if (connections) patch.connections = connections;

      const wf = await getClient().updateWorkflow(id, patch);
      return {
        content: [{ type: "text", text: `Updated workflow "${wf.name}" (ID: ${wf.id})` }],
      };
    }
  );

  // ── delete_workflow ────────────────────────────────────────────────────────
  server.tool(
    "delete_workflow",
    "Permanently delete a workflow by ID.",
    { id: { type: "string", description: "Workflow ID to delete" } },
    async ({ id }: { id: string }) => {
      await getClient().deleteWorkflow(id);
      return { content: [{ type: "text", text: `Deleted workflow ${id}` }] };
    }
  );

  // ── activate_workflow ──────────────────────────────────────────────────────
  server.tool(
    "activate_workflow",
    "Activate a workflow so it runs on its triggers.",
    { id: { type: "string", description: "Workflow ID" } },
    async ({ id }: { id: string }) => {
      const wf = await getClient().activateWorkflow(id);
      return {
        content: [{ type: "text", text: `Workflow "${wf.name}" is now ACTIVE.` }],
      };
    }
  );

  // ── deactivate_workflow ────────────────────────────────────────────────────
  server.tool(
    "deactivate_workflow",
    "Deactivate a workflow so it stops running on its triggers.",
    { id: { type: "string", description: "Workflow ID" } },
    async ({ id }: { id: string }) => {
      const wf = await getClient().deactivateWorkflow(id);
      return {
        content: [{ type: "text", text: `Workflow "${wf.name}" is now INACTIVE.` }],
      };
    }
  );

  // ── trigger_webhook ────────────────────────────────────────────────────────
  server.tool(
    "trigger_webhook",
    "Trigger a webhook-based workflow by its webhook path.",
    {
      webhook_path: { type: "string", description: "The webhook path (e.g. 'my-webhook' from the Webhook node URL)" },
      payload: { type: "object", description: "JSON payload to send" },
      method: { type: "string", description: "HTTP method: GET or POST (default POST)" },
    },
    async ({
      webhook_path,
      payload = {},
      method = "POST",
    }: {
      webhook_path: string;
      payload?: Record<string, unknown>;
      method?: "GET" | "POST";
    }) => {
      const result = await getClient().triggerWebhook(webhook_path, payload, method);
      return {
        content: [{ type: "text", text: `Webhook triggered. Response:\n${JSON.stringify(result, null, 2)}` }],
      };
    }
  );
}
