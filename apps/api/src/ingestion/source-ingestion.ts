// src/ingestion/source-ingestion.ts — Source ingestion: URLs, PDFs, YouTube

import { Storage } from '../storage/storage.js';
import { uuid, nowUtc } from '../types/common.js';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface IngestSourceResult {
  source_id: string;
  episode_id: string;
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
    const text = execSync(`pdftotext -layout "${pdfPath}" -`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

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
      text = execSync(
        `yt-dlp --write-auto-sub --sub-lang en --skip-download --sub-format vtt -o /tmp/scratchpad/yt_%(id)s "${url}" 2>/dev/null && cat /tmp/scratchpad/yt_${videoId}.en.vtt 2>/dev/null || echo ""`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
      );
      // Clean VTT
      text = text
        .replace(/WEBVTT.*/g, '')
        .replace(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}.*/g, '')
        .replace(/<[^>]+>/g, '')
        .trim();
    } catch {
      text = `YouTube video: ${url} (transcript unavailable)`;
    }

    return this.processContent(sourceId, title, text, url, 'youtube', sessionId);
  }

  async ingestText(
    text: string,
    title: string,
    sessionId: string,
    sourceType: string = 'text',
  ): Promise<IngestSourceResult> {
    const sourceId = uuid();
    return this.processContent(sourceId, title, text, null, sourceType, sessionId);
  }

  private async processContent(
    sourceId: string,
    title: string,
    text: string,
    sourceUrl: string | null,
    sourceType: string,
    sessionId: string,
  ): Promise<IngestSourceResult> {
    const now = nowUtc();

    const db = this.storage.getKysely();

    // Store source record
    await db
      .insertInto('sources')
      .values({
        id: sourceId,
        title,
        url: sourceUrl,
        source_type: sourceType,
        content_length: text.length,
        created_at: now,
      })
      .execute();

    // Each submission is its own closed episode. Extraction runs on exactly
    // this content and never re-reads whatever else landed in the session.
    // Pasted text is something the user said; URLs, PDFs and transcripts are
    // documents and get document-mode extraction.
    const mode = sourceType === 'text' ? 'user' : 'document';
    const episodeId = uuid();
    await db
      .insertInto('episodes')
      .values({
        id: episodeId,
        session_id: sessionId,
        started_at: now,
        ended_at: now,
        extraction_mode: mode,
      })
      .execute();

    // Chunk content (max ~2000 chars per chunk)
    const chunks = this.chunkText(text, 2000);

    for (const chunk of chunks) {
      const content = `[Source: ${title}${sourceUrl ? ` (${sourceUrl})` : ''}] ${chunk}`;
      await db
        .insertInto('turns')
        .values({
          id: uuid(),
          episode_id: episodeId,
          session_id: sessionId,
          role: 'user',
          content,
          ts: now,
          source_id: sourceId,
        })
        .execute();
    }

    return {
      source_id: sourceId,
      episode_id: episodeId,
      title,
      content_length: text.length,
      chunks: chunks.length,
      turns_created: chunks.length,
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
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  private extractYouTubeId(url: string): string {
    const match = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    );
    return match ? match[1] : url;
  }
}
