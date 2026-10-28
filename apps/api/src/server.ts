// src/server.ts — Hono HTTP API server

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { MemoryService } from './api/service.js';
import { uuid } from './types/common.js';

const STORAGE_DIR = process.env.SEME_STORAGE_DIR || `${process.env.HOME}/.hominem`;
const EMBEDDING_DIM = parseInt(process.env.SEME_EMBEDDING_DIM || '1024');

const service = new MemoryService({ storageDir: STORAGE_DIR, embeddingDim: EMBEDDING_DIM });

// Seed identity core on startup
service.seedIdentityCore(
  { name: 'User' },
  'The user. Identity core not yet configured.'
).catch(() => {});

const app = new Hono();

// CORS for the web dashboard. Local dev origins are always allowed; extra
// origins (e.g. a deployed dashboard) come from SEME_ALLOWED_ORIGINS as a
// comma-separated list. Nothing else is ever echoed back.
const LOCAL_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
];
const EXTRA_ORIGINS = (process.env.SEME_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set([...LOCAL_ORIGINS, ...EXTRA_ORIGINS]);

const CORS_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const CORS_HEADERS = 'Content-Type, Authorization';

app.use('*', async (c, next) => {
  const origin = c.req.header('origin');
  const allowed = !!origin && ALLOWED_ORIGINS.has(origin);

  if (allowed) {
    c.header('Access-Control-Allow-Origin', origin!);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Methods', CORS_METHODS);
    c.header('Access-Control-Allow-Headers', CORS_HEADERS);
    c.header('Access-Control-Allow-Credentials', 'true');
  }

  if (c.req.method === 'OPTIONS') {
    // Preflight: only advertise the origin when it is on the allowlist.
    const headers: Record<string, string> = { Vary: 'Origin' };
    if (allowed) {
      headers['Access-Control-Allow-Origin'] = origin!;
      headers['Access-Control-Allow-Methods'] = CORS_METHODS;
      headers['Access-Control-Allow-Headers'] = CORS_HEADERS;
      headers['Access-Control-Allow-Credentials'] = 'true';
      headers['Access-Control-Max-Age'] = '600';
    }
    return new Response(null, { status: 204, headers });
  }

  await next();
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

// List memories
app.get('/memories', (c) => {
  const status = c.req.query('status') || undefined;
  const kind = c.req.query('kind') || undefined;
  const slot = c.req.query('slot') || undefined;
  const search = c.req.query('search') || undefined;
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  return c.json(service.listMemories(status, kind, slot, search, limit, offset));
});

// 1. record_turn
app.post('/sessions/:sessionId/turns', async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json();
  try {
    const result = await service.recordTurn(sessionId, body.role, body.content, body.ts, body.turn_id);
    return c.json(result, 201);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'record_turn' } }, 400);
  }
});

// 2. end_session
app.post('/sessions/:sessionId/end', async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json().catch(() => ({}));
  try {
    const result = await service.endSession(sessionId, body.ended_at);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'end_session' } }, 400);
  }
});

// 3. retrieve_context
app.post('/sessions/:sessionId/retrieve', async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json();
  try {
    const timeRangeHint = body.since || body.before || body.asOf ? {
      since: body.since,
      before: body.before,
      asOf: body.asOf,
      from: body.from,
      to: body.to,
      historical: body.historical,
    } : undefined;
    const result = await service.retrieveContext(sessionId, body.user_message || '', timeRangeHint);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'retrieve_context' } }, 400);
  }
});

// 4. remember_command
app.post('/memory/remember', async (c) => {
  const body = await c.req.json();
  try {
    const result = await service.rememberCommand(body.session_id, body.content, body.source_turn_id, body.kind_hint);
    return c.json(result, 201);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'remember_command' } }, 400);
  }
});

// 5. forget_command
app.post('/memory/forget', async (c) => {
  const body = await c.req.json();
  try {
    const result = await service.forgetCommand(body.scope, body.memory_id, body.slot, body.topic, body.episode_id, body.confirmed_irreversible);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'forget_command' } }, 400);
  }
});

// 6. boundary_command
app.post('/memory/boundary', async (c) => {
  const body = await c.req.json();
  try {
    const result = await service.boundaryCommand(body.session_id, body.content, body.source_turn_id);
    return c.json(result, 201);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'boundary_command' } }, 400);
  }
});

// 7. get_profile
app.get('/profile', (c) => {
  const result = service.getProfile();
  return c.json(result || { profile_text: '', profile_version: 0, compiled_at: null, source_memory_ids: [] });
});

// Sleep job
app.post('/sleep-job', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const result = await service.runSleepJob(body.trigger || 'manual');
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'run_sleep_job' } }, 400);
  }
});

// Health metrics
app.get('/health-metrics', (c) => {
  const db = service.getStorage();
  const countsByStatus: Record<string, number> = {};
  const statusRows = db.read((d: any) => d.prepare('SELECT status, COUNT(*) as c FROM memories GROUP BY status').all()) as any[];
  for (const r of statusRows) countsByStatus[r.status] = r.c;
  const total = db.read((d: any) => (d.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c);
  const quarantine = db.read((d: any) => (d.prepare("SELECT COUNT(*) as c FROM memories WHERE status = 'quarantined'").get() as any).c);
  return c.json({ counts_by_status: countsByStatus, quarantine_count: quarantine, total_memories: total });
});

// Review queue
app.get('/review-queue', (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  const itemType = c.req.query('item_type') || undefined;
  return c.json(service.reviewQueueList(limit, offset, itemType));
});

app.post('/review-queue/:itemId/resolve', async (c) => {
  const itemId = c.req.param('itemId');
  const body = await c.req.json();
  try {
    const result = service.resolveReviewItem(itemId, body.decision, body.chosen_memory_id, body.edited_value_text);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'resolve_review_item' } }, 400);
  }
});
// Export data
app.get('/export', async (c) => {
  try {
    const result = await service.exportData();
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'export_data' } }, 400);
  }
});

// Pause learning
app.post('/learning/pause', async (c) => {
  const result = await service.pauseLearning();
  return c.json(result);
});

// Resume learning
app.post('/learning/resume', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await service.resumeLearning(body.process_paused_episodes);
  return c.json(result);
});

// Learning state
app.get('/learning/state', (c) => {
  return c.json({ learning_state: service.getLearningState() });
});

// Identity core
app.get('/identity', (c) => {
  const result = service.getIdentityCore();
  return c.json(result || { error: 'not seeded' });
});

app.put('/identity', async (c) => {
  const body = await c.req.json();
  const result = await service.seedIdentityCore(body.content_json, body.rendered_text);
  return c.json(result);
});

// === Knowledge Graph Endpoints ===

// Entities
app.get('/entities', (c) => {
  const type = c.req.query('type') || undefined;
  const search = c.req.query('search') || undefined;
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  return c.json(service.listEntities(type, search, limit, offset));
});

app.get('/entities/name/:name', (c) => {
  const name = c.req.param('name');
  const result = service.getEntityByName(name);
  if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Entity not found', operation: 'get_entity' } }, 404);
  return c.json(result);
});

app.get('/entities/:id', (c) => {
  const id = c.req.param('id');
  const result = service.getEntity(id);
  if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Entity not found', operation: 'get_entity' } }, 404);
  return c.json(result);
});

app.post('/entities', async (c) => {
  const body = await c.req.json();
  try {
    const result = service.createEntity(body.name, body.type, body.aliases, body.description, body.source_type, body.confidence);
    return c.json({ id: result }, 201);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'create_entity' } }, 400);
  }
});

app.put('/entities/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  try {
    service.updateEntity(id, body);
    return c.json({ updated: true });
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'update_entity' } }, 400);
  }
});

app.delete('/entities/:id', async (c) => {
  const id = c.req.param('id');
  try {
    service.deleteEntity(id);
    return c.json({ deleted: true });
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'delete_entity' } }, 400);
  }
});

// Relationships
app.get('/relationships', (c) => {
  const sourceId = c.req.query('source_id') || undefined;
  const targetId = c.req.query('target_id') || undefined;
  const relationType = c.req.query('relation_type') || undefined;
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  return c.json(service.listRelationships(sourceId, targetId, relationType, limit, offset));
});

app.get('/relationships/:id', (c) => {
  const id = c.req.param('id');
  const result = service.getRelationship(id);
  if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Relationship not found', operation: 'get_relationship' } }, 404);
  return c.json(result);
});

app.post('/relationships', async (c) => {
  const body = await c.req.json();
  try {
    const result = service.createRelationship(body.source_id, body.target_id, body.relation_type, body.description, body.source_turn_id, body.source_episode_id, body.source_type, body.confidence);
    return c.json({ id: result }, 201);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'create_relationship' } }, 400);
  }
});

app.delete('/relationships/:id', async (c) => {
  const id = c.req.param('id');
  try {
    service.deleteRelationship(id);
    return c.json({ deleted: true });
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'delete_relationship' } }, 400);
  }
});

// Graph traversal
app.get('/graph/neighborhood/:entityId', (c) => {
  const entityId = c.req.param('entityId');
  const depth = parseInt(c.req.query('depth') || '2');
  return c.json(service.getNeighborhood(entityId, depth));
});

app.get('/graph/path/:from/:to', (c) => {
  const fromId = c.req.param('from');
  const toId = c.req.param('to');
  const result = service.findPath(fromId, toId);
  if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'No path found', operation: 'find_path' } }, 404);
  return c.json(result);
});

app.get('/graph/snapshot', (c) => {
  return c.json(service.getGraphSnapshot());
});

// Graph-aware search
app.post('/graph/search', async (c) => {
  const body = await c.req.json();
  try {
    const result = await service.retrieveContext(body.session_id || 'default', body.user_message || '', body.time_range_hint);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'graph_search' } }, 400);
  }
});

// Wiki pages
app.get('/wiki', (c) => {
  const entityId = c.req.query('entity_id') || undefined;
  const pageType = c.req.query('page_type') || undefined;
  const maturity = c.req.query('maturity') || undefined;
  const status = c.req.query('status') || undefined;
  const search = c.req.query('search') || undefined;
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  return c.json(service.listWikiPages({ entity_id: entityId, page_type: pageType, maturity, status, search, limit, offset }));
});

app.get('/wiki/:id', (c) => {
  const id = c.req.param('id');
  const result = service.getWikiPage(id);
  if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Wiki page not found', operation: 'get_wiki_page' } }, 404);
  return c.json(result);
});

app.get('/wiki/entity/:entityId', (c) => {
  const entityId = c.req.param('entityId');
  const pageType = c.req.query('page_type') || undefined;
  const result = service.getWikiPageByEntity(entityId, pageType);
  if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Wiki page not found', operation: 'get_wiki_page' } }, 404);
  return c.json(result);
});

app.post('/wiki', async (c) => {
  const body = await c.req.json();
  try {
    const result = service.createWikiPage(body);
    return c.json({ id: result }, 201);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'create_wiki_page' } }, 400);
  }
});

app.put('/wiki/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  try {
    const result = service.updateWikiPage(id, body);
    if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Wiki page not found', operation: 'update_wiki_page' } }, 404);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'update_wiki_page' } }, 400);
  }
});

app.delete('/wiki/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const result = service.deleteWikiPage(id);
    if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Wiki page not found', operation: 'delete_wiki_page' } }, 404);
    return c.json({ deleted: true });
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'delete_wiki_page' } }, 400);
  }
});

app.get('/wiki/:id/versions', (c) => {
  const id = c.req.param('id');
  return c.json(service.getWikiVersions(id));
});

app.get('/wiki/search/:query', (c) => {
  const query = c.req.param('query');
  const limit = parseInt(c.req.query('limit') || '20');
  return c.json(service.searchWikiPages(query, limit));
});

app.post('/wiki/compile/:entityId', async (c) => {
  const entityId = c.req.param('entityId');
  const body = await c.req.json().catch(() => ({}));
  const entityName = body.entity_name || entityId;
  try {
    const result = service.compileWikiForEntity(entityId, entityName);
    if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'No memories found for entity', operation: 'compile_wiki' } }, 404);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'compile_wiki' } }, 400);
  }
});

app.post('/wiki/compile-all', async (c) => {
  try {
    const results = service.compileAllWiki();
    return c.json({ compiled: results.length, pages: results });
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'compile_all_wiki' } }, 400);
  }
});

app.get('/wiki/conflicts/:entityId', (c) => {
  const entityId = c.req.param('entityId');
  return c.json({ conflicts: service.detectWikiConflicts(entityId) });
});

// Source ingestion
app.post('/ingest/source', async (c) => {
  const body = await c.req.json();
  const sessionId = body.session_id || 'default';
  try {
    let result;
    if (body.url && body.url.includes('youtube.com') || body.url?.includes('youtu.be')) {
      result = await service.ingestYouTube(body.url, sessionId);
    } else if (body.url) {
      result = await service.ingestUrl(body.url, sessionId);
    } else if (body.pdf_path) {
      result = await service.ingestPdf(body.pdf_path, sessionId);
    } else if (body.text) {
      result = await service.ingestText(body.text, body.title || 'Untitled', sessionId, body.source_type);
    } else {
      return c.json({ error: { code: 'ERR_VALIDATION', message: 'Must provide url, pdf_path, or text', operation: 'ingest_source' } }, 400);
    }
    return c.json(result, 201);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'ingest_source' } }, 400);
  }
});

app.get('/sources', (c) => {
  return c.json(service.listSources());
});

// Hybrid search
app.post('/search', async (c) => {
  const body = await c.req.json();
  try {
    const result = service.hybridSearchQuery(body.query || '', {
      limit: body.limit,
      include_turns: body.include_turns,
      include_memories: body.include_memories,
      include_wiki: body.include_wiki,
      include_graph: body.include_graph,
      since: body.since,
      before: body.before,
      asOf: body.asOf,
    });
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'hybrid_search' } }, 400);
  }
});

// KB Intelligence
app.post('/kb/challenge', async (c) => {
  const body = await c.req.json();
  return c.json(service.kbChallenge(body.claim || ''));
});

app.post('/kb/emerge', async (c) => {
  return c.json(service.kbEmerge());
});

app.post('/kb/connect', async (c) => {
  const body = await c.req.json();
  return c.json(service.kbConnect(body.topic_a || '', body.topic_b || ''));
});

app.get('/kb/contradictions', (c) => {
  return c.json({ contradictions: service.kbContradictions() });
});

app.post('/kb/lint', async (c) => {
  return c.json(service.kbLint());
});

// KB Tasks
app.post('/tasks', async (c) => {
  const body = await c.req.json();
  try {
    const id = service.createTask(body);
    return c.json({ id }, 201);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'create_task' } }, 400);
  }
});

app.get('/tasks', (c) => {
  const status = c.req.query('status') || undefined;
  const priority = c.req.query('priority') || undefined;
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  return c.json(service.listTasks({ status, priority, limit, offset }));
});

app.get('/tasks/:id', (c) => {
  const id = c.req.param('id');
  const result = service.getTask(id);
  if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Task not found', operation: 'get_task' } }, 404);
  return c.json(result);
});

app.patch('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  try {
    const result = service.updateTask(id, body);
    if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Task not found', operation: 'update_task' } }, 404);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'update_task' } }, 400);
  }
});

app.delete('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const result = service.deleteTask(id);
    if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Task not found', operation: 'delete_task' } }, 404);
    return c.json({ deleted: true });
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'delete_task' } }, 400);
  }
});

// Auto-deprecation
app.post('/deprecation/run', async (c) => {
  return c.json(service.runAutoDeprecation());
});

app.get('/deprecation/thresholds', (c) => {
  return c.json(service.getDeprecationThresholds());
});

// Procedures
app.post('/procedures', async (c) => {
  const body = await c.req.json();
  try {
    const id = service.createProcedure(body);
    return c.json({ id }, 201);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'create_procedure' } }, 400);
  }
});

app.get('/procedures', (c) => {
  const type = c.req.query('procedure_type') || undefined;
  const status = c.req.query('status') || undefined;
  const trigger = c.req.query('trigger') || undefined;
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  return c.json(service.listProcedures({ procedure_type: type, status, trigger, limit, offset }));
});

app.get('/procedures/:id', (c) => {
  const id = c.req.param('id');
  const result = service.getProcedure(id);
  if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Procedure not found', operation: 'get_procedure' } }, 404);
  return c.json(result);
});

app.patch('/procedures/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  try {
    const result = service.updateProcedure(id, body);
    if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Procedure not found', operation: 'update_procedure' } }, 404);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'update_procedure' } }, 400);
  }
});

app.delete('/procedures/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const result = service.deleteProcedure(id);
    if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Procedure not found', operation: 'delete_procedure' } }, 404);
    return c.json({ deleted: true });
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'delete_procedure' } }, 400);
  }
});

app.get('/procedures/match/:trigger', (c) => {
  const trigger = c.req.param('trigger');
  return c.json({ procedures: service.findProcedures(trigger) });
});

// Per-memory feedback
app.post('/memories/:id/feedback', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  try {
    const result = service.memoryFeedback(id, body.signal_type || 'explicit_rating', body.detail);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'memory_feedback' } }, 400);
  }
});

// Data import
app.post('/import', async (c) => {
  const body = await c.req.json();
  try {
    const result = service.importData(body.bundle || body, body.strategy || 'skip');
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'import_data' } }, 400);
  }
});

// Integrations
app.get('/integrations', (c) => {
  return c.json(service.listIntegrations());
});

app.get('/integrations/known', (c) => {
  return c.json(service.listKnownServices());
});

app.post('/integrations/connect', async (c) => {
  const body = await c.req.json();
  try {
    const id = service.connectIntegration(body.service_name, body.auth_type, body.scopes);
    return c.json({ id }, 201);
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'connect_integration' } }, 400);
  }
});

app.patch('/integrations/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  try {
    const result = service.setIntegrationStatus(id, body.status, body.credentials);
    if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Integration not found', operation: 'update_integration' } }, 404);
    return c.json({ updated: true });
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'update_integration' } }, 400);
  }
});

app.delete('/integrations/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const result = service.deleteIntegration(id);
    if (!result) return c.json({ error: { code: 'ERR_NOT_FOUND', message: 'Integration not found', operation: 'delete_integration' } }, 404);
    return c.json({ deleted: true });
  } catch (e: any) {
    return c.json({ error: { code: parseErrorCode(e.message), message: e.message, operation: 'delete_integration' } }, 400);
  }
});

function parseErrorCode(msg: string): string {
  if (msg.includes('ERR_VALIDATION')) return 'ERR_VALIDATION';
  if (msg.includes('ERR_NOT_FOUND')) return 'ERR_NOT_FOUND';
  if (msg.includes('ERR_GATE_FAILED')) return 'ERR_GATE_FAILED';
  if (msg.includes('ERR_CONFLICT')) return 'ERR_CONFLICT';
  if (msg.includes('ERR_PAUSED')) return 'ERR_PAUSED';
  if (msg.includes('ERR_LOCKED')) return 'ERR_LOCKED';
  return 'ERR_INTERNAL';
}

const port = parseInt(process.env.PORT || '3000');
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Seme API server running on http://localhost:${info.port}`);
  console.log(`Storage: ${STORAGE_DIR}`);
});

export { app };