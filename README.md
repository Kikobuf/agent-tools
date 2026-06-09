# agent-tools

Two MCP servers that fill real gaps in the Claude + automation ecosystem.

| Package | What it does |
|---|---|
| [`@agent-tools/n8n-mcp`](./packages/n8n-mcp) | Build, deploy, trigger, and debug n8n workflows with Claude |
| [`@agent-tools/ollama-mcp`](./packages/ollama-mcp) | Run local Ollama models with automatic Claude fallback |

---

## n8n MCP — Your AI automation engineer

> *"Build me a workflow that watches my Supabase table for new rows and sends a Slack DM"*
> → Claude builds it, pushes it to n8n, activates it. Done.

**[→ n8n MCP docs](./packages/n8n-mcp/README.md)**

## Ollama MCP — Local-first inference with zero-config fallback

> Set your primary model to `llama3.2`. When Claude usage limits hit, every request automatically reroutes to `claude-sonnet-4-6`. No manual switching, no broken workflows.

**[→ Ollama MCP docs](./packages/ollama-mcp/README.md)**

---

## Quick install (Claude Code)

```bash
# n8n
claude mcp add n8n-mcp -e N8N_BASE_URL=http://localhost:5678 -e N8N_API_KEY=your-key -- npx @agent-tools/n8n-mcp

# Ollama
claude mcp add ollama-mcp -e OLLAMA_BASE_URL=http://localhost:11434 -e ANTHROPIC_API_KEY=your-key -- npx @agent-tools/ollama-mcp
```

## Quick install (Claude Desktop)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "n8n": {
      "command": "npx",
      "args": ["@agent-tools/n8n-mcp"],
      "env": {
        "N8N_BASE_URL": "http://localhost:5678",
        "N8N_API_KEY": "your-n8n-api-key"
      }
    },
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

## License

MIT
