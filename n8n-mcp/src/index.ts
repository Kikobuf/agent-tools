#!/usr/bin/env node

// ── SDK version check ──────────────────────────────────────────────────────────
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require("@modelcontextprotocol/sdk/package.json");
  const [major, minor] = (pkg.version as string).split(".").map(Number);
  if (major < 1 || (major === 1 && minor < 10)) {
    console.error(
      `\n[n8n-mcp] ERROR: @modelcontextprotocol/sdk ${pkg.version} is too old.\n` +
      `HTTP transport requires >= 1.10.0.\n` +
      `Fix: npm install @modelcontextprotocol/sdk@latest\n`
    );
    process.exit(1);
  }
} catch { /* non-blocking */ }

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { N8nClient } from "./n8nClient.js";
import { registerWorkflowTools } from "./tools/workflows.js";
import { registerExecutionTools } from "./tools/executions.js";
import { registerUtilityTools } from "./tools/utility.js";
import http from "http";

// ── Transport mode ─────────────────────────────────────────────────────────────
// --transport stdio  (default) — for Claude Code, local agents
// --transport http   — for Claude Desktop custom connector, remote deploy

const args = process.argv.slice(2);
const transportMode = args.includes("--transport")
  ? args[args.indexOf("--transport") + 1]
  : (process.env.MCP_TRANSPORT ?? "stdio");

const HTTP_PORT = parseInt(process.env.PORT ?? "3100", 10);

// ── Build MCP server for a given set of credentials ───────────────────────────

function buildServer(baseUrl: string, apiKey: string) {
  const client = new N8nClient(baseUrl, apiKey);

  // Register additional instances from env
  // N8N_INSTANCE_PROD_URL / N8N_INSTANCE_PROD_KEY etc.
  for (const key of Object.keys(process.env)) {
    const match = key.match(/^N8N_INSTANCE_(.+)_URL$/);
    if (match) {
      const name = match[1].toLowerCase();
      const url = process.env[key];
      const instanceKey = process.env[`N8N_INSTANCE_${match[1]}_KEY`];
      if (url && instanceKey) {
        client.addInstance(name, url, instanceKey);
      }
    }
  }

  const server = new McpServer({
    name: "n8n-mcp",
    version: "1.0.0",
    description:
      "Build, deploy, trigger and debug n8n workflows with Claude. " +
      "Schema-aware workflow generation, execution debugging, multi-instance support.",
  });

  const getClient = () => client;
  registerWorkflowTools(server, getClient);
  registerExecutionTools(server, getClient);
  registerUtilityTools(server, getClient);

  return server;
}

// ── STDIO mode ─────────────────────────────────────────────────────────────────

async function runStdio() {
  const baseUrl = process.env.N8N_BASE_URL;
  const apiKey = process.env.N8N_API_KEY;

  if (!baseUrl || !apiKey) {
    console.error(
      "Error: N8N_BASE_URL and N8N_API_KEY are required in stdio mode.\n\n" +
      "Usage:\n" +
      "  N8N_BASE_URL=http://localhost:5678 N8N_API_KEY=your-key npx @agent-tools/n8n-mcp\n\n" +
      "Or add to Claude Code:\n" +
      "  claude mcp add n8n-mcp -e N8N_BASE_URL=http://localhost:5678 -e N8N_API_KEY=your-key -- npx @agent-tools/n8n-mcp"
    );
    process.exit(1);
  }

  const server = buildServer(baseUrl, apiKey);
  await server.connect(new StdioServerTransport());
  console.error(`n8n MCP (stdio) connected to ${baseUrl}`);
}

// ── HTTP mode ──────────────────────────────────────────────────────────────────
// Each request can carry credentials in headers:
//   x-n8n-base-url: http://your-n8n.com
//   x-n8n-api-key: your-key
//
// Falls back to N8N_BASE_URL / N8N_API_KEY env vars if headers not present.
// This lets one deployed server serve multiple users with their own n8n instances.

// ── CORS helper ────────────────────────────────────────────────────────────────
// Claude Desktop sends an OPTIONS preflight before connecting.
// Without this the connection silently fails with no useful error.
function setCorsHeaders(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", [
    "Content-Type",
    "Authorization",
    "x-n8n-base-url",
    "x-n8n-api-key",
    "mcp-session-id",
  ].join(", "));
  res.setHeader("Access-Control-Max-Age", "86400");
}

async function runHttp() {
  const envBaseUrl = process.env.N8N_BASE_URL;
  const envApiKey = process.env.N8N_API_KEY;

  const httpServer = http.createServer(async (req, res) => {
    setCorsHeaders(res);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: "n8n-mcp", version: "1.0.0" }));
      return;
    }

    // Pull credentials from request headers or fall back to env
    const baseUrl =
      (req.headers["x-n8n-base-url"] as string) ?? envBaseUrl;
    const apiKey =
      (req.headers["x-n8n-api-key"] as string) ?? envApiKey;

    if (!baseUrl || !apiKey) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "Missing credentials. Provide x-n8n-base-url and x-n8n-api-key headers, " +
            "or set N8N_BASE_URL and N8N_API_KEY environment variables on the server.",
        })
      );
      return;
    }

    // Per-request MCP server + transport (stateless — each request is independent)
    const server = buildServer(baseUrl, apiKey);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, await readBody(req));
  });

  httpServer.listen(HTTP_PORT, () => {
    console.error(
      `n8n MCP (HTTP) listening on port ${HTTP_PORT}\n` +
      `\n` +
      `Connect in Claude Desktop:\n` +
      `  URL: http://localhost:${HTTP_PORT}  (or your public tunnel URL)\n` +
      `\n` +
      `Per-request auth headers:\n` +
      `  x-n8n-base-url: http://your-n8n-instance.com\n` +
      `  x-n8n-api-key: your-api-key\n` +
      `\n` +
      `Health check: http://localhost:${HTTP_PORT}/health`
    );
  });
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ── Entry ──────────────────────────────────────────────────────────────────────

async function main() {
  if (transportMode === "http") {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
