import { N8nClient } from "../n8nClient.js";

export function registerUtilityTools(server: any, getClient: () => N8nClient) {
  // ── list_node_types ────────────────────────────────────────────────────────
  server.tool(
    "list_node_types",
    "List all node types available on this n8n instance. Use this before building a workflow to know what's installed.",
    {
      search: { type: "string", description: "Filter by name (optional)" },
    },
    async ({ search }: { search?: string }) => {
      const types = await getClient().listNodeTypes();
      const filtered = search
        ? types.filter(
            (t) =>
              t.name.toLowerCase().includes(search.toLowerCase()) ||
              t.displayName.toLowerCase().includes(search.toLowerCase())
          )
        : types;

      const summary = filtered.map((t) => ({
        name: t.name,
        displayName: t.displayName,
        group: t.group,
        version: t.version,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  // ── get_node_schema ────────────────────────────────────────────────────────
  server.tool(
    "get_node_schema",
    "Get the full parameter schema for a specific node type. Always call this before using a node in create_workflow to ensure correct parameter shapes.",
    { node_type: { type: "string", description: "Node type name e.g. n8n-nodes-base.slack" } },
    async ({ node_type }: { node_type: string }) => {
      const schema = await getClient().getNodeType(node_type);
      return {
        content: [{ type: "text", text: JSON.stringify(schema, null, 2) }],
      };
    }
  );

  // ── list_credentials ───────────────────────────────────────────────────────
  server.tool(
    "list_credentials",
    "List available credentials on this n8n instance (names and types only, no secrets).",
    {},
    async () => {
      const creds = await getClient().listCredentials();
      return {
        content: [{ type: "text", text: JSON.stringify(creds, null, 2) }],
      };
    }
  );

  // ── list_tags ──────────────────────────────────────────────────────────────
  server.tool(
    "list_tags",
    "List all workflow tags.",
    {},
    async () => {
      const tags = await getClient().listTags();
      return {
        content: [{ type: "text", text: JSON.stringify(tags, null, 2) }],
      };
    }
  );

  // ── list_variables ─────────────────────────────────────────────────────────
  server.tool(
    "list_variables",
    "List all n8n environment variables (keys only, not values).",
    {},
    async () => {
      const vars = await getClient().listVariables();
      const safe = vars.map((v) => ({ id: v.id, key: v.key }));
      return {
        content: [{ type: "text", text: JSON.stringify(safe, null, 2) }],
      };
    }
  );

  // ── switch_instance ────────────────────────────────────────────────────────
  server.tool(
    "switch_instance",
    "Switch to a different configured n8n instance (e.g. prod, staging, local).",
    { instance: { type: "string", description: "Instance name to switch to" } },
    async ({ instance }: { instance: string }) => {
      getClient().switchInstance(instance);
      return {
        content: [{ type: "text", text: `Switched to n8n instance: "${instance}"` }],
      };
    }
  );

  // ── list_instances ─────────────────────────────────────────────────────────
  server.tool(
    "list_instances",
    "List all configured n8n instances and show which one is active.",
    {},
    async () => {
      const client = getClient();
      const instances = client.listInstances();
      const active = client.getActiveInstance();
      const result = instances.map((i) => ({
        name: i,
        active: i === active,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
