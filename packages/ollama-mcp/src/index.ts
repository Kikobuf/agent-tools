#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "http";
import axios from "axios";

// ── SDK version check ──────────────────────────────────────────────────────────
// StreamableHTTPServerTransport requires MCP SDK >= 1.10.0
// This check runs at startup and gives a clear error instead of a cryptic crash.
try {
  const pkg = require("@modelcontextprotocol/sdk/package.json");
  const [major, minor] = (pkg.version as string).split(".").map(Number);
  if (major < 1 || (major === 1 && minor < 10)) {
    console.error(
      `\n[ollama-mcp] ERROR: @modelcontextprotocol/sdk ${pkg.version} is installed.\n` +
      `HTTP transport requires >= 1.10.0.\n` +
      `Fix: npm install @modelcontextprotocol/sdk@latest\n`
    );
    process.exit(1);
  }
} catch {
  // If we can't read the version, continue — don't block stdio mode over this
}

// ── Transport mode ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const transportMode = args.includes("--transport")
  ? args[args.indexOf("--transport") + 1]
  : (process.env.MCP_TRANSPORT ?? "stdio");

const HTTP_PORT = parseInt(process.env.PORT ?? "3101", 10);

// ── Config ─────────────────────────────────────────────────────────────────────
const DEFAULT_OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const DEFAULT_LOCAL_MODEL = process.env.OLLAMA_DEFAULT_MODEL ?? "llama3.2";
const FALLBACK_MODEL = process.env.OLLAMA_FALLBACK_MODEL ?? "claude-sonnet-4-6";

// Named model routes: OLLAMA_ROUTE_FAST=llama3.2:3b  OLLAMA_ROUTE_CODE=deepseek-coder:6.7b
const routes: Record<string, string> = {};
for (const [key, val] of Object.entries(process.env)) {
  const match = key.match(/^OLLAMA_ROUTE_(.+)$/);
  if (match && val) routes[match[1].toLowerCase()] = val;
}

// Per-process fallback toggle (stdio mode only)
let globalFallbackEnabled = false;
let globalFallbackEnabledAt: Date | null = null;

// ── Claude-style system prompt ─────────────────────────────────────────────────
// Injected into every Ollama request so local models respond with Claude's tone:
// warm, clear, conversational prose — not the terse/technical default Ollama style.
// Users can override this entirely with OLLAMA_SYSTEM_PROMPT env var.
const CLAUDE_STYLE_SYSTEM_PROMPT = process.env.OLLAMA_SYSTEM_PROMPT ?? `You are a helpful, knowledgeable AI assistant. Match this communication style precisely:

TONE & PERSONALITY
- Warm and conversational, never cold or robotic
- Confident but not arrogant — acknowledge uncertainty when it exists
- Treat the person as an intelligent adult; never talk down to them
- Engage genuinely with what they're actually asking, not a surface-level reading of it

RESPONSE FORMAT
- Default to clear prose, not bullet points or headers, unless the content genuinely calls for structure
- Keep responses focused and appropriately sized — don't pad, don't over-explain
- Never start a response with "Certainly!", "Of course!", "Great question!", or any hollow affirmation
- Don't add unnecessary preamble before answering — just answer
- When you disagree or see a problem, say so directly but constructively

TECHNICAL CONTENT
- Match the technical depth to how the person is asking — mirror their vocabulary
- Use concrete examples when they help, skip them when they don't
- Prefer plain English explanations before introducing technical terms
- For code: explain the why, not just the what

Be genuinely helpful. That means sometimes pushing back, asking a clarifying question, or saying you're not sure — rather than producing a confident-sounding answer that misses the point.`;

// ── Types ──────────────────────────────────────────────────────────────────────
interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }
interface OllamaModel {
  name: string; size: number; modified_at: string;
  details?: { family: string; parameter_size: string; quantization_level: string };
}

// ── Ollama API helpers ─────────────────────────────────────────────────────────
async function ollamaHealth(baseUrl = DEFAULT_OLLAMA_URL): Promise<boolean> {
  try { await axios.get(`${baseUrl}/`, { timeout: 3000 }); return true; } catch { return false; }
}

async function ollamaChat(
  model: string,
  messages: ChatMessage[],
  baseUrl = DEFAULT_OLLAMA_URL
): Promise<string> {
  // Inject Claude-style system prompt if no system message is already present
  const hasSystemMsg = messages.some(m => m.role === "system");
  const finalMessages: ChatMessage[] = hasSystemMsg
    ? messages
    : [{ role: "system", content: CLAUDE_STYLE_SYSTEM_PROMPT }, ...messages];

  const res = await axios.post(`${baseUrl}/api/chat`, {
    model,
    messages: finalMessages,
    stream: false,
  });
  return res.data.message?.content ?? "";
}

async function ollamaGenerate(
  model: string,
  prompt: string,
  baseUrl = DEFAULT_OLLAMA_URL,
  options?: Record<string, unknown>
): Promise<string> {
  // Wrap raw generate prompts with the style system context
  const wrappedPrompt = `${CLAUDE_STYLE_SYSTEM_PROMPT}\n\n${prompt}`;
  const res = await axios.post(`${baseUrl}/api/generate`, {
    model,
    prompt: wrappedPrompt,
    stream: false,
    options,
  });
  return res.data.response ?? "";
}

async function ollamaListModels(baseUrl = DEFAULT_OLLAMA_URL): Promise<OllamaModel[]> {
  const res = await axios.get(`${baseUrl}/api/tags`);
  return res.data.models ?? [];
}

async function ollamaPull(model: string, baseUrl = DEFAULT_OLLAMA_URL): Promise<void> {
  await axios.post(`${baseUrl}/api/pull`, { name: model, stream: false });
}

async function ollamaDelete(model: string, baseUrl = DEFAULT_OLLAMA_URL): Promise<void> {
  await axios.delete(`${baseUrl}/api/delete`, { data: { name: model } });
}

// ── Claude API fallback ────────────────────────────────────────────────────────
// Only used in agent contexts (James/OpenClaw, LangChain, custom scripts).
// Not needed when running inside Claude Desktop or Claude Code.
async function claudeApiFallback(
  messages: ChatMessage[],
  apiKey: string,
  model = FALLBACK_MODEL
): Promise<{ response: string; model: string }> {
  const nonSystem = messages.filter(m => m.role !== "system");
  const systemMsg = messages.find(m => m.role === "system")?.content;
  const body: Record<string, unknown> = { model, max_tokens: 4096, messages: nonSystem };
  if (systemMsg) body.system = systemMsg;
  const res = await axios.post("https://api.anthropic.com/v1/messages", body, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
  });
  return { response: res.data.content?.[0]?.text ?? "", model };
}

// ── Smart router ───────────────────────────────────────────────────────────────
async function routedChat(params: {
  messages: ChatMessage[];
  model?: string;
  forceFallback?: boolean;
  ollamaUrl?: string;
  anthropicApiKey?: string;
  fallbackEnabled?: boolean;
}): Promise<{ response: string; model: string; usedFallback: boolean; ollamaDown?: boolean }> {
  const {
    messages,
    model,
    forceFallback = false,
    ollamaUrl = DEFAULT_OLLAMA_URL,
    anthropicApiKey,
    fallbackEnabled = globalFallbackEnabled,
  } = params;

  const resolvedModel =
    (model && routes[model.toLowerCase()])
      ? routes[model.toLowerCase()]
      : (model ?? DEFAULT_LOCAL_MODEL);

  // Force fallback
  if (forceFallback || fallbackEnabled) {
    if (!anthropicApiKey) {
      return {
        response:
          "Fallback mode is enabled but no Anthropic API key was provided. " +
          "If you're using Claude Desktop or Claude Code, Ollama is the only provider needed here.",
        model: "none",
        usedFallback: false,
      };
    }
    const result = await claudeApiFallback(messages, anthropicApiKey);
    return { ...result, usedFallback: true };
  }

  // Try Ollama first
  const healthy = await ollamaHealth(ollamaUrl);
  if (healthy) {
    try {
      const response = await ollamaChat(resolvedModel, messages, ollamaUrl);
      return { response, model: resolvedModel, usedFallback: false };
    } catch (err: any) {
      if (err?.response?.status !== 404 && !err?.message?.includes("model")) throw err;
      // Model not installed — fall through
    }
  }

  // Ollama down or model missing — try Claude API if available
  if (anthropicApiKey) {
    const result = await claudeApiFallback(messages, anthropicApiKey);
    return { ...result, usedFallback: true, ollamaDown: !healthy };
  }

  // No fallback available
  return {
    response: healthy
      ? `Model "${resolvedModel}" is not installed. Run: ollama pull ${resolvedModel}`
      : `Ollama is not reachable at ${ollamaUrl}. Make sure it's running: ollama serve`,
    model: "none",
    usedFallback: false,
    ollamaDown: !healthy,
  };
}

// ── MCP server builder ─────────────────────────────────────────────────────────
function buildServer(opts: {
  ollamaUrl?: string;
  anthropicApiKey?: string;
  isHttpMode?: boolean;
}) {
  const { ollamaUrl = DEFAULT_OLLAMA_URL, anthropicApiKey, isHttpMode = false } = opts;
  const server = new McpServer({ name: "ollama-mcp", version: "1.0.0" });
  type S = Record<string, any>;

  server.tool(
    "ollama_chat",
    "Chat with a local Ollama model using Claude-style tone and formatting. " +
    "Automatically falls back to Claude API if configured and Ollama is unavailable. " +
    "No API key needed when running inside Claude Desktop or Claude Code.",
    {
      messages: { type: "array", description: "Chat messages [{role, content}]" } as any,
      model: { type: "string", description: `Model name or route alias (default: ${DEFAULT_LOCAL_MODEL})` } as any,
      force_fallback: { type: "boolean", description: "Force Claude API fallback (requires API key)" } as any,
      custom_system_prompt: { type: "string", description: "Override the default Claude-style system prompt for this request only" } as any,
    } as S,
    async (args: any) => {
      const { messages, model, force_fallback, custom_system_prompt } =
        args as { messages: ChatMessage[]; model?: string; force_fallback?: boolean; custom_system_prompt?: string };

      // If a custom system prompt is provided for this request, inject it
      let finalMessages = messages as ChatMessage[];
      if (custom_system_prompt) {
        const withoutSystem = messages.filter((m: ChatMessage) => m.role !== "system");
        finalMessages = [{ role: "system", content: custom_system_prompt }, ...withoutSystem];
      }

      const result = await routedChat({
        messages: finalMessages,
        model,
        forceFallback: force_fallback,
        ollamaUrl,
        anthropicApiKey,
      });

      const label = result.usedFallback
        ? `[Claude API: ${result.model}]`
        : result.model === "none"
          ? "[Error]"
          : `[Ollama: ${result.model}]`;

      return { content: [{ type: "text" as const, text: `${label}\n\n${result.response}` }] };
    }
  );

  server.tool(
    "ollama_generate",
    "Raw text completion against a local Ollama model. Claude-style tone applied automatically.",
    {
      prompt: { type: "string", description: "Prompt to complete" } as any,
      model: { type: "string", description: `Model to use (default: ${DEFAULT_LOCAL_MODEL})` } as any,
      options: { type: "object", description: "Ollama options: temperature, top_p, etc." } as any,
    } as S,
    async (args: any) => {
      const { prompt, model, options } = args as { prompt: string; model?: string; options?: Record<string, unknown> };
      const resolvedModel = (model && routes[model.toLowerCase()]) ? routes[model.toLowerCase()] : (model ?? DEFAULT_LOCAL_MODEL);
      if (!await ollamaHealth(ollamaUrl)) {
        return { content: [{ type: "text" as const, text: `Ollama not reachable at ${ollamaUrl}. Run: ollama serve` }] };
      }
      const response = await ollamaGenerate(resolvedModel, prompt, ollamaUrl, options);
      return { content: [{ type: "text" as const, text: response }] };
    }
  );

  server.tool("ollama_list_models", "List all locally installed Ollama models.", {},
    async () => {
      if (!await ollamaHealth(ollamaUrl)) {
        return { content: [{ type: "text" as const, text: `Ollama not reachable at ${ollamaUrl}` }] };
      }
      const models = await ollamaListModels(ollamaUrl);
      const summary = models.map(m => ({
        name: m.name,
        size_gb: (m.size / 1e9).toFixed(2) + " GB",
        family: m.details?.family,
        params: m.details?.parameter_size,
        modified: m.modified_at,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
    }
  );

  server.tool("ollama_pull_model", "Download and install a model from the Ollama registry.",
    { model: { type: "string", description: "e.g. llama3.2, mistral, deepseek-coder:6.7b" } as any } as S,
    async (args: any) => {
      await ollamaPull((args as any).model, ollamaUrl);
      return { content: [{ type: "text" as const, text: `✓ Pulled: ${(args as any).model}` }] };
    }
  );

  server.tool("ollama_delete_model", "Remove an installed model to free disk space.",
    { model: { type: "string", description: "Model name to delete" } as any } as S,
    async (args: any) => {
      await ollamaDelete((args as any).model, ollamaUrl);
      return { content: [{ type: "text" as const, text: `✓ Deleted: ${(args as any).model}` }] };
    }
  );

  server.tool("ollama_health", "Check Ollama status and show current configuration.", {},
    async () => {
      const healthy = await ollamaHealth(ollamaUrl);
      const models = healthy ? await ollamaListModels(ollamaUrl) : [];
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ollama_running: healthy,
            ollama_url: ollamaUrl,
            models_installed: models.length,
            default_model: DEFAULT_LOCAL_MODEL,
            fallback_model: FALLBACK_MODEL,
            api_key_configured: !!anthropicApiKey,
            fallback_enabled: isHttpMode ? "(per-request via headers)" : globalFallbackEnabled,
            named_routes: Object.keys(routes).length > 0 ? routes : {},
            style_prompt: "Claude-style system prompt active (override with OLLAMA_SYSTEM_PROMPT env var)",
          }, null, 2),
        }],
      };
    }
  );

  if (!isHttpMode) {
    server.tool(
      "ollama_set_fallback",
      "Enable or disable Claude API fallback. Only relevant in agent contexts where an API key is configured.",
      {
        enabled: { type: "boolean", description: "true = route all requests to Claude API" } as any,
        reason: { type: "string", description: "Reason (optional)" } as any,
      } as S,
      async (args: any) => {
        const { enabled, reason } = args as { enabled: boolean; reason?: string };
        if (enabled && !anthropicApiKey) {
          return { content: [{ type: "text" as const, text: "Cannot enable fallback: ANTHROPIC_API_KEY is not set." }] };
        }
        globalFallbackEnabled = enabled;
        globalFallbackEnabledAt = enabled ? new Date() : null;
        const msg = enabled
          ? `Fallback ENABLED → ${FALLBACK_MODEL}.${reason ? ` Reason: ${reason}` : ""}`
          : "Fallback DISABLED → back to local Ollama.";
        return { content: [{ type: "text" as const, text: msg }] };
      }
    );
  }

  server.tool("ollama_list_routes", "Show named model routes and defaults.", {},
    async () => ({
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          default_model: DEFAULT_LOCAL_MODEL,
          fallback_model: FALLBACK_MODEL,
          named_routes: Object.keys(routes).length > 0 ? routes : "(none)",
          add_routes: "Set OLLAMA_ROUTE_FAST=llama3.2:3b  OLLAMA_ROUTE_CODE=deepseek-coder:6.7b",
          style_prompt: "Active — override with OLLAMA_SYSTEM_PROMPT env var",
        }, null, 2),
      }],
    })
  );

  return server;
}

// ── CORS helper ────────────────────────────────────────────────────────────────
// Claude Desktop sends an OPTIONS preflight before connecting.
// Without this the connection silently fails.
function setCorsHeaders(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", [
    "Content-Type",
    "Authorization",
    "x-ollama-url",
    "x-anthropic-api-key",
    "mcp-session-id",
  ].join(", "));
  res.setHeader("Access-Control-Max-Age", "86400");
}

// ── STDIO entry ────────────────────────────────────────────────────────────────
async function runStdio() {
  const server = buildServer({
    ollamaUrl: DEFAULT_OLLAMA_URL,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    isHttpMode: false,
  });
  await server.connect(new StdioServerTransport());
  console.error(
    `Ollama MCP (stdio) | ${DEFAULT_OLLAMA_URL} | model: ${DEFAULT_LOCAL_MODEL}\n` +
    `Style: Claude-style system prompt active (override: OLLAMA_SYSTEM_PROMPT)\n` +
    `API key: ${process.env.ANTHROPIC_API_KEY ? "✓ set" : "not set (fine for Claude Desktop/Code)"}`
  );
}

// ── HTTP entry ─────────────────────────────────────────────────────────────────
async function runHttp() {
  function readBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

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
      const ollamaOk = await ollamaHealth();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        server: "ollama-mcp",
        version: "1.0.0",
        ollama_running: ollamaOk,
        style_prompt: "active",
      }));
      return;
    }

    const ollamaUrl = (req.headers["x-ollama-url"] as string) ?? DEFAULT_OLLAMA_URL;
    const anthropicApiKey = (req.headers["x-anthropic-api-key"] as string) ?? process.env.ANTHROPIC_API_KEY;

    const server = buildServer({ ollamaUrl, anthropicApiKey, isHttpMode: true });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, await readBody(req));
  });

  httpServer.listen(HTTP_PORT, () => {
    console.error(
      `Ollama MCP (HTTP) on port ${HTTP_PORT}\n` +
      `Style: Claude-style system prompt active\n` +
      `CORS: enabled (OPTIONS preflight handled)\n` +
      `Health: http://localhost:${HTTP_PORT}/health\n` +
      `\n` +
      `Claude Desktop custom connector: http://localhost:${HTTP_PORT}\n` +
      `Optional headers: x-ollama-url, x-anthropic-api-key`
    );
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

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
