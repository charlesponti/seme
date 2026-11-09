import { useCallback, useEffect, useRef, useState } from 'react';
import { semeApi } from '../lib/api';

type Mode = 'text' | 'url';
type Phase = 'form' | 'working' | 'error';

/** Live state of one submission, as reported by GET /ingest/episodes/:id/status. */
interface Progress {
  episode_id: string;
  state: 'running' | 'done' | 'failed';
  stage: string;
  chunks: number | null;
  total?: number;
  done?: number;
  memories_created?: number;
  entities_created?: number;
  relationships_created?: number;
  error?: string;
}

interface AddMemorySheetProps {
  open: boolean;
  onClose: () => void;
  /** Called once a submission finishes, so the dashboard can refresh its numbers. */
  onSaved: () => void;
}

const POLL_MS = 400;
const LEAVE_MS = 200;

const STEPS = [
  { stage: 'extracting_memories', label: 'Reading for memories' },
  { stage: 'saving_memories', label: 'Saving memories' },
  { stage: 'extracting_entities', label: 'Finding entities' },
  { stage: 'resolving_entities', label: 'Resolving entities' },
  { stage: 'linking', label: 'Linking relationships' },
  { stage: 'compiling_profile', label: 'Updating profile' },
] as const;

/** Overall progress for the bar. Within-stage counts move the bar while a stage runs. */
function fraction(p: Progress): number {
  const within = p.total && p.total > 0 ? Math.min(1, (p.done ?? 0) / p.total) : 0;
  switch (p.stage) {
    case 'extracting_memories':
      return 0.1;
    case 'saving_memories':
      return 0.1 + within * 0.4;
    case 'extracting_entities':
      return 0.55;
    case 'resolving_entities':
      return 0.55 + within * 0.3;
    case 'linking':
      return 0.9;
    case 'compiling_profile':
      return 0.96;
    case 'done':
      return 1;
    default:
      return 0.03;
  }
}

function stepIndex(stage: string): number {
  return STEPS.findIndex((s) => s.stage === stage);
}

export function AddMemorySheet({ open, onClose, onSaved }: AddMemorySheetProps) {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);

  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [statusLost, setStatusLost] = useState(false);

  const textRef = useRef<HTMLTextAreaElement>(null);

  // Enter/leave: mount first, then flip `entered` on the next frame so the CSS transition runs.
  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(id);
    }
    setEntered(false);
    const t = setTimeout(() => setMounted(false), LEAVE_MS);
    return () => clearTimeout(t);
  }, [open]);

  // Escape closes; body scroll is locked while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    textRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Poll live progress while a submission is running. Stops on done/failed or unmount.
  useEffect(() => {
    if (!episodeId || phase !== 'working') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const p: Progress = await semeApi.ingestStatus(episodeId);
        if (cancelled) return;
        // A 404 comes back as an error body with no `state`. A failed run has `state: 'failed'`.
        if (typeof p?.state !== 'string') {
          // The API forgot this submission (it restarted). The memory is still saved.
          setStatusLost(true);
          setPhase('form');
          setProgress(null);
          onSaved();
          return;
        }
        setProgress(p);
        if (p.state === 'running') {
          timer = setTimeout(tick, POLL_MS);
        } else if (p.state === 'done') {
          onSaved();
        }
      } catch {
        if (!cancelled) timer = setTimeout(tick, POLL_MS * 3);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // onSaved is stable from the dashboard; only the episode and phase drive polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId, phase]);

  const canSubmit = mode === 'text' ? text.trim().length > 0 : url.trim().length > 0;

  const submit = useCallback(async () => {
    if (!canSubmit || phase === 'working') return;
    setPhase('working');
    setSubmitError(null);
    setStatusLost(false);
    setProgress(null);
    try {
      const res =
        mode === 'text'
          ? await semeApi.submitText(text.trim(), 'Web Submission')
          : await semeApi.submitUrl(url.trim());
      if (res?.error) throw new Error(res.error.message ?? 'Ingest failed');
      setEpisodeId(res.episode_id);
      setProgress({
        episode_id: res.episode_id,
        state: 'running',
        stage: 'queued',
        chunks: typeof res.chunks === 'number' ? res.chunks : null,
      });
    } catch (e) {
      setPhase('error');
      setSubmitError(e instanceof Error ? e.message : 'Submit failed');
    }
  }, [canSubmit, mode, phase, text, url]);

  const addAnother = () => {
    setText('');
    setUrl('');
    setEpisodeId(null);
    setProgress(null);
    setPhase('form');
    setStatusLost(false);
    requestAnimationFrame(() => textRef.current?.focus({ preventScroll: true }));
  };

  if (!mounted) return null;

  const percent = progress ? Math.round(fraction(progress) * 100) : 0;
  const currentIndex = progress
    ? progress.stage === 'done'
      ? STEPS.length
      : stepIndex(progress.stage)
    : -1;
  const finished = progress?.state === 'done';
  const failed = progress?.state === 'failed';

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={onClose}
        className={`absolute inset-0 bg-[#171717]/20 transition-opacity duration-200 ease-out motion-reduce:transition-none ${
          entered ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-memory-title"
        className={`absolute inset-x-0 bottom-0 mx-auto flex max-h-[88vh] w-full max-w-[640px] flex-col rounded-t-[8px] border border-b-0 border-[#eaeaea] bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-transform duration-200 ease-out motion-reduce:transition-none ${
          entered ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[#d4d4d4]" />

        <div className="flex shrink-0 items-center justify-between gap-4 px-6 pb-3 pt-4">
          <h2
            id="add-memory-title"
            style={{ fontFamily: 'var(--font-serif)' }}
            className="text-[20px] leading-7 text-[#171717]"
          >
            Add memory
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[#666666] hover:bg-[#f5f5f5] hover:text-[#171717]"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {phase === 'form' && (
            <>
              {statusLost && (
                <p className="mb-4 font-mono text-[12px] leading-[18px] text-[#666666]">
                  Saved. Live progress isn’t available for that one anymore.
                </p>
              )}
              <div
                role="tablist"
                className="relative grid grid-cols-2 rounded-[6px] border border-[#eaeaea] bg-[#fafafa] p-0.5"
              >
                <div
                  aria-hidden
                  className={`absolute bottom-0.5 left-0.5 top-0.5 w-[calc(50%-2px)] rounded-[4px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-transform duration-200 ease-out motion-reduce:transition-none ${
                    mode === 'url' ? 'translate-x-full' : 'translate-x-0'
                  }`}
                />
                {(['text', 'url'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mode === m}
                    onClick={() => setMode(m)}
                    className={`relative z-10 h-8 text-[13px] transition-colors duration-150 ease-out motion-reduce:transition-none ${
                      mode === m
                        ? 'font-medium text-[#171717]'
                        : 'text-[#888888] hover:text-[#171717]'
                    }`}
                  >
                    {m === 'text' ? 'Text' : 'URL'}
                  </button>
                ))}
              </div>

              <div className="relative mt-4 overflow-hidden">
                <div
                  className={`transition-all duration-200 ease-out motion-reduce:transition-none ${
                    mode === 'text'
                      ? 'translate-x-0 opacity-100'
                      : 'pointer-events-none absolute inset-0 -translate-x-4 opacity-0'
                  }`}
                >
                  <textarea
                    ref={textRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
                    }}
                    placeholder="Paste a block of text, a conversation, or notes…"
                    aria-label="Memory text"
                    className="min-h-[180px] w-full resize-y rounded-[6px] border border-[#d4d4d4] bg-white p-3 text-[14px] leading-5 text-[#171717] placeholder:text-[#888888] focus:border-[#171717] focus:outline-none"
                  />
                  <div className="mt-1.5 flex justify-between font-mono text-[11px] leading-[18px] tabular-nums text-[#888888]">
                    <span>⌘ + Enter to save</span>
                    <span>{text.length.toLocaleString('en-US')} chars</span>
                  </div>
                </div>

                <div
                  className={`transition-all duration-200 ease-out motion-reduce:transition-none ${
                    mode === 'url'
                      ? 'translate-x-0 opacity-100'
                      : 'pointer-events-none absolute inset-0 translate-x-4 opacity-0'
                  }`}
                >
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com/article"
                    aria-label="Article URL"
                    className="h-11 w-full rounded-[6px] border border-[#d4d4d4] bg-white px-3 text-[14px] text-[#171717] placeholder:text-[#888888] focus:border-[#171717] focus:outline-none"
                  />
                  <p className="mt-1.5 font-mono text-[11px] leading-[18px] text-[#888888]">
                    Seme fetches the page and reads it as a document.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] text-[#888888]">
                  Extraction runs in the background
                </span>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className="h-9 rounded-[6px] bg-black px-5 text-[13px] font-medium text-white transition-opacity duration-150 hover:bg-[#171717] disabled:opacity-40 motion-reduce:transition-none"
                >
                  Save memory
                </button>
              </div>
            </>
          )}

          {phase === 'error' && (
            <div className="rounded-[8px] border border-[#eaeaea] p-4">
              <p className="text-[13px] leading-5 text-[#171717]">Could not save: {submitError}</p>
              <button
                type="button"
                onClick={() => setPhase('form')}
                className="mt-3 h-8 rounded-[6px] border border-[#d4d4d4] bg-white px-3 text-[12px] font-medium text-[#171717] hover:bg-[#f5f5f5]"
              >
                Back to form
              </button>
            </div>
          )}

          {phase === 'working' && progress && (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-mono text-[12px] leading-[18px] text-[#666666]">
                  {progress.chunks !== null
                    ? `${progress.chunks} ${progress.chunks === 1 ? 'chunk' : 'chunks'}`
                    : 'Saved'}
                  {' · '}
                  {finished ? 'complete' : failed ? 'failed' : 'working'}
                </p>
                <span className="font-mono text-[12px] tabular-nums text-[#171717]">
                  {percent}%
                </span>
              </div>

              <div
                className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#eaeaea]"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-[#171717] transition-[width] duration-300 ease-out motion-reduce:transition-none"
                  style={{ width: `${percent}%` }}
                />
              </div>

              <ol className="mt-5 space-y-3">
                <StepRow label="Saved" state="done" />
                {STEPS.map((step, i) => {
                  const state =
                    i < currentIndex
                      ? 'done'
                      : i === currentIndex && !finished && !failed
                        ? 'active'
                        : finished
                          ? 'done'
                          : 'pending';
                  const detail = state === 'active' ? countFor(progress) : null;
                  return (
                    <StepRow key={step.stage} label={step.label} state={state} detail={detail} />
                  );
                })}
              </ol>

              {finished && (
                <div className="mt-6 grid grid-cols-3 border-y border-[#eaeaea]">
                  <Tally label="Memories" value={progress.memories_created ?? 0} />
                  <Tally label="Entities" value={progress.entities_created ?? 0} bordered />
                  <Tally
                    label="Relationships"
                    value={progress.relationships_created ?? 0}
                    bordered
                  />
                </div>
              )}

              {failed && (
                <div className="mt-6 rounded-[8px] border border-[#eaeaea] p-4">
                  <p className="text-[13px] leading-5 text-[#171717]">
                    Extraction failed: {progress.error ?? 'unknown error'}
                  </p>
                </div>
              )}

              {(finished || failed) && (
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={addAnother}
                    className="h-9 rounded-[6px] border border-[#d4d4d4] bg-white px-4 text-[13px] font-medium text-[#171717] hover:bg-[#f5f5f5]"
                  >
                    Add another
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-9 rounded-[6px] bg-black px-4 text-[13px] font-medium text-white hover:bg-[#171717]"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function countFor(p: Progress): string | null {
  if (p.total === undefined || p.total === 0) return null;
  return `${p.done ?? 0} / ${p.total}`;
}

function StepRow({
  label,
  state,
  detail,
}: {
  label: string;
  state: 'done' | 'active' | 'pending';
  detail?: string | null;
}) {
  return (
    <li
      className={`flex items-center gap-3 transition-opacity duration-200 ease-out motion-reduce:transition-none ${state === 'pending' ? 'opacity-40' : 'opacity-100'}`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
        {state === 'done' && (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#171717]">
            <svg width="9" height="9" viewBox="0 0 9 9">
              <path
                d="M1.5 4.5l2 2 4-4.5"
                stroke="#ffffff"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
        {state === 'active' && (
          <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-[#171717] border-t-transparent motion-reduce:animate-none" />
        )}
        {state === 'pending' && (
          <span className="h-3.5 w-3.5 rounded-full border border-[#d4d4d4]" />
        )}
      </span>
      <span
        className={`text-[14px] leading-5 ${state === 'active' ? 'text-[#171717]' : 'text-[#666666]'}`}
      >
        {label}
      </span>
      {detail && (
        <span className="ml-auto font-mono text-[12px] tabular-nums text-[#666666]">{detail}</span>
      )}
    </li>
  );
}

function Tally({ label, value, bordered }: { label: string; value: number; bordered?: boolean }) {
  return (
    <div className={`px-3 py-4 ${bordered ? 'border-l border-[#eaeaea]' : ''}`}>
      <CountUp
        value={value}
        className="font-mono text-[24px] leading-8 tabular-nums text-[#171717]"
      />
      <div className="mt-1 text-[11px] uppercase leading-4 tracking-[0.08em] text-[#888888]">
        {label}
      </div>
    </div>
  );
}

/** Counts up to `value` over ~500ms. Jumps straight there when reduced motion is requested. */
function CountUp({ value, className }: { value: number; className?: string }) {
  const [animated, setAnimated] = useState(0);
  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const instant = reduce || value === 0;

  useEffect(() => {
    if (instant) return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 500);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimated(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, instant]);

  return <div className={className}>{instant ? value : animated}</div>;
}
