// src/embeddings/embedding-provider.ts
// Generates text embeddings via Ollama (local, free) or OpenRouter (fallback).

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dim: number;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;
  public dim: number;

  constructor(model: string = 'qwen3-embedding:0.6b', baseUrl: string = 'http://localhost:11434', dim: number = 1024) {
    this.model = model;
    this.baseUrl = baseUrl;
    this.dim = dim;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { embeddings: number[][] };
    return data.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { embeddings: number[][] };
    return data.embeddings;
  }
}

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  public dim: number;

  constructor(apiKey: string, model: string = 'openai/text-embedding-3-small', dim: number = 1536) {
    this.apiKey = apiKey;
    this.model = model;
    this.dim = dim;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!res.ok) throw new Error(`OpenRouter embed failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { data: { embedding: number[] }[] };
    return data.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`OpenRouter embed failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { data: { embedding: number[] }[] };
    return data.data.map(d => d.embedding);
  }
}

export class NoOpEmbeddingProvider implements EmbeddingProvider {
  public dim: number = 0;
  async embed(_text: string): Promise<number[]> { return []; }
  async embedBatch(_texts: string[]): Promise<number[][]> { return []; }
}
export function createEmbeddingProvider(): EmbeddingProvider {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const ollamaModel = process.env.OLLAMA_EMBED_MODEL || 'qwen3-embedding:0.6b';
  const apiKey = process.env.OPENROUTER_API_KEY;
  
  // Prefer Ollama (local, free)
  return new OllamaEmbeddingProvider(ollamaModel, ollamaUrl, 1024);
}