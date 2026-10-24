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