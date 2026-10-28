# Seme MCP Server

Seme exposes its memory system over the Model Context Protocol, so any MCP-aware
client (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Zed) can read and
write long-term memory.

## Requirements

- Node 20+
- The API built: `cd apps/api && npm install && npm run build`
- Ollama with `qwen3-embedding:0.6b` for vector search (optional — Seme degrades
  to keyword-only retrieval without it)
  ```bash
  ollama pull qwen3-embedding:0.6b
  ```

## Run it directly

```bash
cd apps/api
npm run mcp
```

The server speaks newline-delimited JSON-RPC over stdio. It is not an HTTP server —
your MCP client spawns it as a subprocess.

Storage defaults to `~/.hominem`. Override with `SEME_STORAGE_DIR`.

## Client configuration

### Claude Code

```bash
claude mcp add seme -- node /absolute/path/to/apps/api/dist/mcp/mcp-server.js
```

Or add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "seme": {
      "command": "node",
      "args": ["/absolute/path/to/apps/api/dist/mcp/mcp-server.js"],
      "env": { "SEME_STORAGE_DIR": "/Users/you/.hominem" }
    }
  }
}
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "seme": {
      "command": "node",
      "args": ["/absolute/path/to/apps/api/dist/mcp/mcp-server.js"]
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (or project `.cursor/mcp.json`) — same `mcpServers` shape.

### VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "seme": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/apps/api/dist/mcp/mcp-server.js"]
    }
  }
}
```

## Tools

| Tool | Purpose |
|---|---|
| `seme_save` | Store a memory (`fact`, `preference`, `decision`, `observation`, …) |
| `seme_recall` | Retrieve memories matching a query |
| `seme_get_context` | Full retrieval context: memories, profile, procedural rules, graph |
| `seme_correct` | Correct a memory by ID (creates a supersession, keeps history) |
| `seme_forget` | Hard-delete a memory by ID |
| `seme_graph_stats` | Node and edge counts |
| `seme_list_entities` | List graph entities, filterable by type or search text |
| `seme_wiki_search` | Search compiled wiki pages |
| `seme_wiki_recall` | Get the wiki page for a named entity |
| `seme_profile` | Compiled user profile |
| `seme_list_memories` | List memories with status/kind filters |
| `seme_sleep` | Run the consolidation job (dedupe, contradictions, decay) |
| `seme_pause` / `seme_resume` | Pause or resume learning |

## Verifying the integration

```bash
cd apps/api
npm run build
npm run test:mcp
```

The test spawns the server, performs `initialize` → `tools/list` → `tools/call`
for save/recall/stats/profile/entities, and asserts a JSON-RPC `-32601` for an
unknown method. Expected: `MCP TEST: 8/8 passed`.

## Notes

- `seme_save` writes a memory immediately but does **not** run entity extraction.
  Entity and relationship extraction happens in the pipeline when a session ends
  (`POST /sessions/:id/end`) or when text is ingested (`POST /ingest/source`).
- Every memory keeps provenance: the turn, episode, and source document that
  produced it.
