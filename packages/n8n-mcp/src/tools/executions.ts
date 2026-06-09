import { N8nClient } from "../n8nClient.js";

export function registerExecutionTools(server: any, getClient: () => N8nClient) {
  // ── list_executions ────────────────────────────────────────────────────────
  server.tool(
    "list_executions",
    "List recent workflow executions. Filter by workflow, status, or limit.",
    {
      workflow_id: { type: "string", description: "Filter by workflow ID (optional)" },
      status: {
        type: "string",
        description: "Filter by status: success | error | running | waiting | canceled (optional)",
      },
      limit: { type: "number", description: "Max results to return (default 20)" },
    },
    async ({
      workflow_id,
      status,
      limit = 20,
    }: {
      workflow_id?: string;
      status?: string;
      limit?: number;
    }) => {
      const executions = await getClient().listExecutions({
        workflowId: workflow_id,
        status,
        limit,
      });

      const summary = executions.map((e) => ({
        id: e.id,
        workflowId: e.workflowId,
        status: e.status,
        startedAt: e.startedAt,
        stoppedAt: e.stoppedAt,
        finished: e.finished,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  // ── get_execution ──────────────────────────────────────────────────────────
  server.tool(
    "get_execution",
    "Get full details of a specific execution including output data.",
    { id: { type: "string", description: "Execution ID" } },
    async ({ id }: { id: string }) => {
      const exec = await getClient().getExecution(id, true);
      return {
        content: [{ type: "text", text: JSON.stringify(exec, null, 2) }],
      };
    }
  );

  // ── debug_execution ────────────────────────────────────────────────────────
  server.tool(
    "debug_execution",
    "Analyze a failed execution and explain what went wrong in plain English with fix suggestions.",
    { id: { type: "string", description: "Execution ID to debug" } },
    async ({ id }: { id: string }) => {
      const exec = await getClient().getExecution(id, true);

      if (exec.status === "success") {
        return {
          content: [{ type: "text", text: `Execution ${id} completed successfully. No errors to debug.` }],
        };
      }

      const error = exec.data?.resultData?.error;
      const runData = exec.data?.resultData?.runData;

      // Find which nodes ran and which didn't
      const nodesRun = runData ? Object.keys(runData) : [];
      const errorMsg = error ? `${error.message}\n${error.stack ?? ""}` : "Unknown error";

      const report = `EXECUTION DEBUG REPORT
ID: ${id}
Status: ${exec.status}
Started: ${exec.startedAt}
Stopped: ${exec.stoppedAt ?? "N/A"}

ERROR:
${errorMsg}

NODES THAT RAN (${nodesRun.length}):
${nodesRun.map((n) => `  ✓ ${n}`).join("\n") || "  (none)"}

RAW EXECUTION DATA:
${JSON.stringify(exec.data?.resultData, null, 2)}`;

      return { content: [{ type: "text", text: report }] };
    }
  );

  // ── delete_execution ───────────────────────────────────────────────────────
  server.tool(
    "delete_execution",
    "Delete an execution record by ID.",
    { id: { type: "string", description: "Execution ID to delete" } },
    async ({ id }: { id: string }) => {
      await getClient().deleteExecution(id);
      return { content: [{ type: "text", text: `Deleted execution ${id}` }] };
    }
  );
}
