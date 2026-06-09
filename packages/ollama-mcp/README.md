# @agent-tools/ollama-mcp

**Local-first inference with zero-config Claude fallback.**

Run `llama3.2` locally for free. When Claude usage limits hit — or Ollama goes down — every request automatically reroutes to `claude-sonnet-4-6`. No manual switching. No broken agent workflows.

---

## The problem this solves

You're running Claude Code heavily and hit the usage limit mid-workflow. Everything stops. You either wait, or manually swap every prompt to a different provider.

`ollama-mcp` solves this by making your local Ollama instance the **primary** and Claude the **automatic fallback**. One config, both providers, zero interruption.

---

## Install

### Claude Code

```bash
claude mcp add ollama-mcp \
  -e ANTHROPIC_API_KEY=your-key \
  -e OLLAMA_DEFAULT_MODEL=llama3.2 \
  -- npx @agent-tools/ollama-mcp
```

### Claude Desktop

```json
{
  "mcpServers": {
    "ollama": {
      "command": "npx",
      "args": ["@agent-tools/ollama-mcp"],
      "env": {
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "ANTHROPIC_API_KEY": "your-anthropic-key",
        "OLLAMA_DEFAULT_MODEL": "llama3.2",
        "OLLAMA_FALLBACK_MODEL": "claude-sonnet-4-6"
      }
    }
  }
}
```

---

## Tools

| Tool | Description |
|---|---|
| `ollama_chat` | Chat with a local model (auto-falls back to Claude) |
| `ollama_generate` | Raw completion prompt |
| `ollama_list_models` | All installed models with sizes |
| `ollama_pull_model` | Download a model from Ollama registry |
| `ollama_delete_model` | Remove a model to free disk space |
| `ollama_health` | Check Ollama status + fallback config |
| `ollama_set_fallback` | Manually enable/disable Claude fallback mode |
| `ollama_list_routes` | Show named model routes |

---

## Named model routes

Map shorthand names to specific models in your env:

```json
{
  "env": {
    "OLLAMA_ROUTE_FAST": "llama3.2:3b",
    "OLLAMA_ROUTE_CODE": "deepseek-coder:6.7b",
    "OLLAMA_ROUTE_SMART": "llama3.1:70b"
  }
}
```

Then ask: *"Use the 'code' model to review this function"* — Claude routes to `deepseek-coder:6.7b` automatically.

---

## Fallback behavior

Requests automatically route to Claude when:

1. **Ollama is unreachable** (not running, wrong port, network issue)
2. **Model not installed** locally (404 from Ollama)
3. **Fallback manually enabled** via `ollama_set_fallback` tool
4. **`force_fallback: true`** passed in the chat request

The response always includes a header showing which provider answered:

```
[Responded via local model: llama3.2]
...

[Responded via Claude fallback: claude-sonnet-4-6]
...
```

---

## Usage limit workflow

When you hit Claude usage limits:

```
"Enable fallback mode — I've hit my Claude usage limit"
```

→ `ollama_set_fallback(enabled: true)` — all subsequent requests go to your local Ollama models until you disable it.

When limits reset:
```
"Disable fallback mode, my Claude limits reset"
```

→ Back to local models as primary.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_DEFAULT_MODEL` | `llama3.2` | Default local model |
| `OLLAMA_FALLBACK_MODEL` | `claude-sonnet-4-6` | Claude model for fallback |
| `ANTHROPIC_API_KEY` | — | Required for Claude fallback |
| `OLLAMA_ROUTE_<NAME>` | — | Named route mappings |

---

## Requirements

- Node.js 18+
- [Ollama](https://ollama.ai) running locally
- Anthropic API key (for fallback — optional but recommended)

---

## License

MIT
