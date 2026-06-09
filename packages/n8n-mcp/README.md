# @agent-tools/n8n-mcp

**Your AI automation engineer.** Describe what you want to automate. Claude builds, deploys, and debugs your n8n workflows.

```
"Build me a workflow that monitors my Supabase waitlist table and
 sends me a Slack DM when signups exceed 100"
```

→ Claude fetches your node schemas, builds the workflow JSON, pushes it to n8n, activates it. No clipboard, no JSON editing, no context switching.

---

## What it does

| Tool | Description |
|---|---|
| `list_workflows` | List all workflows with status |
| `get_workflow` | Get full workflow definition |
| `explain_workflow` | Plain-English explanation of any workflow |
| `create_workflow` | Build and push a new workflow |
| `update_workflow` | Patch nodes/connections on existing workflow |
| `delete_workflow` | Delete a workflow |
| `activate_workflow` | Enable a workflow |
| `deactivate_workflow` | Disable a workflow |
| `trigger_webhook` | Fire a webhook-based workflow |
| `list_executions` | Recent runs with status filter |
| `get_execution` | Full execution data |
| `debug_execution` | AI-powered failure analysis in plain English |
| `delete_execution` | Clean up execution history |
| `list_node_types` | All nodes available on your instance |
| `get_node_schema` | Exact parameter shape for any node (used before building) |
| `list_credentials` | Available credentials (names only, no secrets) |
| `list_tags` | All workflow tags |
| `list_variables` | n8n environment variables |
| `switch_instance` | Switch between multiple n8n instances |
| `list_instances` | Show all configured instances |

---

## Install

### Claude Code

```bash
claude mcp add n8n-mcp \
  -e N8N_BASE_URL=http://localhost:5678 \
  -e N8N_API_KEY=your-api-key \
  -- npx @agent-tools/n8n-mcp
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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
    }
  }
}
```

### Get your n8n API key

n8n Settings → API → Create API Key

---

## Multiple instances

Perfect for agencies managing n8n for multiple clients, or running separate prod/staging environments.

```json
{
  "env": {
    "N8N_BASE_URL": "http://localhost:5678",
    "N8N_API_KEY": "local-key",
    "N8N_INSTANCE_PROD_URL": "https://n8n.yourcompany.com",
    "N8N_INSTANCE_PROD_KEY": "prod-key",
    "N8N_INSTANCE_STAGING_URL": "https://n8n-staging.yourcompany.com",
    "N8N_INSTANCE_STAGING_KEY": "staging-key"
  }
}
```

Then just ask: *"Switch to prod and list all active workflows"*

---

## Schema-aware workflow generation

Unlike naive approaches that hallucinate node parameters, `n8n-mcp` fetches the live schema from **your** n8n instance before building a workflow. This means:

- Correct parameter names for your exact n8n version
- Only uses nodes that are actually installed
- References real credential names from your instance

Claude automatically calls `get_node_schema` before `create_workflow`. You don't have to do anything.

---

## Dry run mode

Not sure what Claude is about to create? Use dry run:

*"Build me a Gmail → Notion workflow but don't deploy it yet, just show me what it would do"*

Claude describes every node, every connection, and the full flow in plain English before touching n8n.

---

## Example prompts

```
List all my active workflows

Why did my Slack notification workflow fail last night?

Build a workflow that:
- Triggers every day at 9am
- Fetches my Shopify orders from the last 24 hours
- Sends a summary to my Telegram

Explain what the "Customer Onboarding" workflow does

Pause all active workflows — I'm doing a database migration

Switch to my staging instance and test the webhook trigger
```

---

## Requirements

- Node.js 18+
- n8n instance with API access enabled (Settings → API)
- n8n API key

---

## License

MIT
