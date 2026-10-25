// src/mcp/mcp-server.ts — MCP Server exposing Seme as tools

import { MemoryService } from '../api/service.js';
import * as readline from 'node:readline';
import * as fs from 'node:fs';

const STORAGE_DIR = process.env.SEME_STORAGE_DIR || `${process.env.HOME}/.hominem`;
const EMBEDDING_DIM = 4;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

const service = new MemoryService({ storageDir: STORAGE_DIR, embeddingDim: EMBEDDING_DIM });

// Tool definitions
const TOOLS = [
  { name: 'seme_save', description: 'Save a memory (fact, preference, decision, etc.)', inputSchema: { type: 'object', properties: { content: { type: 'string', description: 'Content to remember' }, kind: { type: 'string', enum: ['fact', 'preference', 'routine', 'decision', 'interest', 'relationship', 'reference', 'anti_pattern', 'observation'], description: 'Memory kind' }, session_id: { type: 'string', description: 'Session ID' } }, required: ['content'] } },
  { name: 'seme_recall', description: 'Recall memories matching a query', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, session_id: { type: 'string', description: 'Session ID' }, limit: { type: 'number', description: 'Max results' } }, required: ['query'] } },
  { name: 'seme_get_context', description: 'Get full context for a session (memories, profile, graph)', inputSchema: { type: 'object', properties: { session_id: { type: 'string', description: 'Session ID' }, user_message: { type: 'string', description: 'Current user message' } }, required: ['session_id', 'user_message'] } },
  { name: 'seme_correct', description: 'Correct a memory by ID', inputSchema: { type: 'object', properties: { memory_id: { type: 'string', description: 'Memory ID to correct' }, new_value: { type: 'string', description: 'Corrected value' } }, required: ['memory_id', 'new_value'] } },
  { name: 'seme_forget', description: 'Forget a memory by ID', inputSchema: { type: 'object', properties: { memory_id: { type: 'string', description: 'Memory ID to forget' } }, required: ['memory_id'] } },
  { name: 'seme_graph_stats', description: 'Get knowledge graph statistics', inputSchema: { type: 'object', properties: {} } },
  { name: 'seme_wiki_search', description: 'Search wiki pages', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, limit: { type: 'number', description: 'Max results' } }, required: ['query'] } },
  { name: 'seme_wiki_recall', description: 'Get wiki page for an entity', inputSchema: { type: 'object', properties: { entity_name: { type: 'string', description: 'Entity name' } }, required: ['entity_name'] } },
  { name: 'seme_profile', description: 'Get the compiled user profile', inputSchema: { type: 'object', properties: {} } },
  { name: 'seme_list_memories', description: 'List memories with filters', inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Status filter' }, kind: { type: 'string', description: 'Kind filter' }, limit: { type: 'number', description: 'Max results' } } } },
  { name: 'seme_list_entities', description: 'List knowledge graph entities', inputSchema: { type: 'object', properties: { type: { type: 'string', description: 'Entity type filter' }, search: { type: 'string', description: 'Search text' } } } },
  { name: 'seme_sleep', description: 'Run the sleep/consolidation job', inputSchema: { type: 'object', properties: { trigger: { type: 'string', description: 'Trigger type' } } } },
  { name: 'seme_pause', description: 'Pause learning', inputSchema: { type: 'object', properties: {} } },
  { name: 'seme_resume', description: 'Resume learning', inputSchema: { type: 'object', properties: {} } },
];

async function handleToolCall(name: string, args: any): Promise<any> {
  switch (name) {
    case 'seme_save': {
      const sessionId = args.session_id || 'mcp-session';
      const turn = await service.recordTurn(sessionId, 'user', args.content);
      await service.rememberCommand(sessionId, args.content, turn.turn_id, args.kind || 'fact');
      return { saved: true, turn_id: turn.turn_id };
    }
    case 'seme_recall': {
      const ctx = service.retrieveContext(args.session_id || 'mcp-session', args.query);
      return { memories: ctx.memories, abstain: ctx.abstain, profile: ctx.profile_text };
    }
    case 'seme_get_context': {
      return service.retrieveContext(args.session_id, args.user_message);
    }
    case 'seme_correct': {
      const result = service.correctMemory(args.memory_id, args.new_value);
      return result;
    }
    case 'seme_forget': {
      service.forgetCommand('memory', args.memory_id);
      return { forgotten: true };
    }
    case 'seme_graph_stats': {
      const snap = service.getGraphSnapshot();
      return { entities: snap.entities.length, relationships: snap.relationships.length };
    }
    case 'seme_wiki_search': {
      return service.searchWikiPages(args.query, args.limit || 20);
    }
    case 'seme_wiki_recall': {
      const entities = service.listEntities(undefined, args.entity_name);
      if (entities.entities.length > 0) {
        const page = service.getWikiPageByEntity(entities.entities[0].id);
        if (page) return page;
      }
      return { error: 'No wiki page found for entity' };
    }
    case 'seme_profile': {
      return service.getProfile();
    }
    case 'seme_list_memories': {
      return service.listMemories(args.status, args.kind, undefined, undefined, args.limit || 50, 0);
    }
    case 'seme_list_entities': {
      return service.listEntities(args.type, args.search);
    }
    case 'seme_sleep': {
      return service.runSleepJob(args.trigger || 'manual');
    }
    case 'seme_pause': {
      service.pauseLearning();
      return { paused: true };
    }
    case 'seme_resume': {
      service.resumeLearning();
      return { resumed: true };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function sendResponse(response: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

function handleRequest(request: JsonRpcRequest): void {
  const { id, method, params } = request;

  if (method === 'initialize') {
    sendResponse({
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'seme', version: '1.0.0' },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') {
    // No response needed
    return;
  }

  if (method === 'tools/list') {
    sendResponse({
      jsonrpc: '2.0',
      id: id ?? null,
      result: { tools: TOOLS },
    });
    return;
  }

  if (method === 'tools/call') {
    (async () => {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    try {
      const result = await handleToolCall(toolName, toolArgs);
      sendResponse({
        jsonrpc: '2.0',
        id: id ?? null,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      });
    } catch (e: any) {
      sendResponse({
        jsonrpc: '2.0',
        id: id ?? null,
        result: { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true },
      });
    }
    })();
    return;
  }

  // Unknown method
  sendResponse({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}

// Main loop
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const request = JSON.parse(line) as JsonRpcRequest;
    handleRequest(request);
  } catch (e) {
    sendResponse({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
  }
});

rl.on('close', () => {
  service.close?.();
  process.exit(0);
});
