// One-shot "quick answer" for dashboard search: all retrieved memories go to DeepSeek in a single
// chat-completions request and come back as a short answer grounded only in those memories.

const MAX_MEMORIES = 40;
const MAX_MEMORY_CHARS = 600;
const TIMEOUT_MS = 20_000;

export class AnswerUnavailableError extends Error {}

export interface AnswerResult {
  answer: string;
  model: string;
  memories_used: number;
}

export function answerConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

export function buildAnswerPrompt(query: string, memories: string[]) {
  const lines = memories.slice(0, MAX_MEMORIES).map((m, i) => `${i + 1}. ${m.slice(0, MAX_MEMORY_CHARS)}`);
  return {
    system:
      'You answer questions from a personal memory store, like a search engine\'s quick answer. ' +
      'Use only the numbered memories provided. Reply in one to three short sentences, plain text, no preamble. ' +
      'If the memories do not contain the answer, say so briefly instead of guessing.',
    user: `Memories:\n${lines.join('\n')}\n\nQuestion: ${query}`,
    used: lines.length,
  };
}

export async function answerFromMemories(query: string, memories: string[]): Promise<AnswerResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new AnswerUnavailableError('DEEPSEEK_API_KEY is not set');
  const clean = memories.filter((m) => typeof m === 'string' && m.trim());
  if (!query.trim() || clean.length === 0) throw new Error('ERR_VALIDATION: query and memories are required');

  const base = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const prompt = buildAnswerPrompt(query, clean);

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 200,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DeepSeek request failed (${res.status})`);
  const data: any = await res.json();
  const answer = String(data?.choices?.[0]?.message?.content ?? '').trim();
  if (!answer) throw new Error('DeepSeek returned an empty answer');
  return { answer, model, memories_used: prompt.used };
}
