// src/server.ts — Hono HTTP API server

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { MemoryService } from './api/service.js';
import { uuid } from './types/common.js';

const STORAGE_DIR = process.env.SEME_STORAGE_DIR || '/tmp/scratchpad/seme-data';
const EMBEDDING_DIM = parseInt(process.env.SEME_EMBEDDING_DIM || '4');

const service = new MemoryService({ storageDir: STORAGE_DIR, embeddingDim: EMBEDDING_DIM });

// Seed identity core on startup
service.seedIdentityCore(
  { name: 'User' },
  'The user. Identity core not yet configured.'
).catch(() => {});

const app = new Hono();

// Health check
app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

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
    const result = service.retrieveContext(sessionId, body.user_message, body.time_range_hint);
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