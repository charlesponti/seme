// src/ingestion/source-ingestion.ts — Source ingestion: URLs, PDFs, YouTube

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface IngestSourceResult {
  source_id: string;
  title: string;
  content_length: number;
  chunks: number;
  turns_created: number;
}

export class SourceIngestion {
  private storage: Storage;
  private storageDir: string;

  constructor(storage: Storage, storageDir: string) {
    this.storage = storage;
    this.storageDir = storageDir;
  }

  async ingestUrl(url: string, sessionId: string): Promise<IngestSourceResult> {
    const sourceId = uuid();
    const now = nowUtc();

    // Fetch URL content
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch URL: ${response.status}`);
    const html = await response.text();

    // Extract text from HTML
    const title = this.extractTitle(html) || url;
    const text = this.htmlToText(html);

    return this.processContent(sourceId, title, text, url, 'url', sessionId);
  }

  async ingestPdf(pdfPath: string, sessionId: string): Promise<IngestSourceResult> {
    const sourceId = uuid();
    const title = path.basename(pdfPath, '.pdf');

    // Use pdftotext
    const text = execSync(`pdftotext -layout "${pdfPath}" -`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

    return this.processContent(sourceId, title, text, pdfPath, 'pdf', sessionId);
  }

  async ingestYouTube(url: string, sessionId: string): Promise<IngestSourceResult> {
    const sourceId = uuid();
    // Extract video ID
    const videoId = this.extractYouTubeId(url);
    const title = `YouTube: ${videoId}`;

    // Try to get transcript via youtube-transcript or yt-dlp
    let text = '';
    try {
      text = execSync(`yt-dlp --write-auto-sub --sub-lang en --skip-download --sub-format vtt -o /tmp/scratchpad/yt_%(id)s "${url}" 2>/dev/null && cat /tmp/scratchpad/yt_${videoId}.en.vtt 2>/dev/null || echo ""`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      // Clean VTT
      text = text.replace(/WEBVTT.*/g, '').replace(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}.*/g, '').replace(/<[^>]+>/g, '').trim();
    } catch {
      text = `YouTube video: ${url} (transcript unavailable)`;
    }

    return this.processContent(sourceId, title, text, url, 'youtube', sessionId);
  }

  async ingestText(text: string, title: string, sessionId: string, sourceType: string = 'text'): Promise<IngestSourceResult> {
    const sourceId = uuid();
    return this.processContent(sourceId, title, text, null, sourceType, sessionId);
  }

  private async processContent(sourceId: string, title: string, text: string, sourceUrl: string | null, sourceType: string, sessionId: string): Promise<IngestSourceResult> {
    const now = nowUtc();

    // Store source record
    this.storage.getDb().prepare(`
      INSERT INTO sources (id, title, url, source_type, content_length, created_at) VALUES (?, ?, ?, ?, ?, ?)
    `).run(sourceId, title, sourceUrl, sourceType, text.length, now);

    // Chunk content (max ~2000 chars per chunk)
    const chunks = this.chunkText(text, 2000);

    // Create turns for each chunk
    let turnCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const content = `[Source: ${title}${sourceUrl ? ` (${sourceUrl})` : ''}] ${chunk}`;
      // Create a turn
      const turnId = uuid();
      // Need an episode first
      // Check if episode exists
      let episode = this.storage.read((db: any) => db.prepare('SELECT id FROM episodes WHERE session_id = ? AND ended_at IS NULL').get(sessionId) as any);
      if (!episode) {
        const epId = uuid();
        this.storage.getDb().prepare('INSERT INTO episodes (id, session_id, started_at) VALUES (?, ?, ?)').run(epId, sessionId, now);
        episode = { id: epId };
      }
      this.storage.getDb().prepare('INSERT INTO turns (id, episode_id, session_id, role, content, ts) VALUES (?, ?, ?, ?, ?, ?)').run(turnId, episode.id, sessionId, 'user', content, now);
      turnCount++;
    }

    return {
      source_id: sourceId,
      title,
      content_length: text.length,
      chunks: chunks.length,
      turns_created: turnCount,
    };
  }

  private chunkText(text: string, maxChunkSize: number): string[] {
    const chunks: string[] = [];
    const paragraphs = text.split(/\n\n+/);
    let current = '';

    for (const para of paragraphs) {
      if (current.length + para.length > maxChunkSize && current.length > 0) {
        chunks.push(current.trim());
        current = para;
      } else {
        current += (current ? '\n\n' : '') + para;
      }
    }
    if (current.trim()) chunks.push(current.trim());

    // If no chunks (empty text), return empty array
    if (chunks.length === 0 && text.trim()) {
      // Fall back to character-based chunking
      for (let i = 0; i < text.length; i += maxChunkSize) {
        chunks.push(text.substring(i, i + maxChunkSize));
      }
    }

    return chunks;
  }

  private extractTitle(html: string): string | null {
    const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
    return match ? match[1].trim() : null;
  }

  private htmlToText(html: string): string {
    // Remove script and style tags
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');
    // Decode HTML entities
    text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  private extractYouTubeId(url: string): string {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : url;
  }
}
