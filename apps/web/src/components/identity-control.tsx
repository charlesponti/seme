import { useCallback, useEffect, useState } from 'react';
import { semeApi } from '../lib/api';
import { Button } from '@ponti-studios/ui/primitives';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ponti-studios/ui/overlays';

interface IdentityDoc {
  content_json?: unknown;
  error?: unknown;
}

// content_json comes back as a JSON string from the API; tolerate an object too.
function parseContent(doc: IdentityDoc): Record<string, unknown> {
  const raw = doc.content_json;
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object') return v as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  return {};
}

const splitAliases = (s: string) => [
  ...new Set(
    s
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
  ),
];

/** Header control for who "I" is. Saving syncs the self entity, so mentions of the name fold into it. */
export function IdentityControl() {
  const [content, setContent] = useState<Record<string, unknown>>({});
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setContent(parseContent(await semeApi.identity()));
    } catch {
      /* the gate handles auth failures */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = typeof content.name === 'string' ? content.name : '';
  const isPlaceholder = !current || current.toLowerCase() === 'user';

  function openDialog() {
    setName(isPlaceholder ? '' : current);
    setAliases(Array.isArray(content.aliases) ? (content.aliases as string[]).join(', ') : '');
    setError(null);
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = { ...content, name: trimmed, aliases: splitAliases(aliases) };
      const res = await semeApi.setIdentity(next, `The user is ${trimmed}.`);
      if (res?.error) throw new Error('Save failed');
      setContent(parseContent(res));
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {isPlaceholder ? 'Set your name' : current}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your name</DialogTitle>
            <DialogDescription>
              Who “I” is in your memories. Mentions of this name resolve to you instead of a
              separate person.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">
                Also known as (comma separated)
              </span>
              <input
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                placeholder="Chuck, CJ"
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
              />
            </label>
            {error && <p className="text-sm text-foreground">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
