import { useEffect, useLayoutEffect, useRef } from 'react';
import { Icon } from '@/shared/ui';

const typingIn = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * The one box for everything: paste a teammate's reply, an issue or PR link, or describe the task.
 * Typing shows quick matches; Enter (or pasting) asks Claude which chat it belongs to. "/" or ⌘K focuses it.
 */
export function SearchBox({ q, onChange, onAsk, onClear, busy }: { q: string; onChange: (q: string) => void; onAsk: (text?: string) => void; onClear: () => void; busy: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grows with what you paste (up to ~7 lines); one line when empty.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '';
    // The placeholder counts toward scrollHeight, so an empty box always stays one line.
    if (q && (q.includes('\n') || el.scrollHeight > el.clientHeight + 2)) el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === '/' && !typingIn(e.target)) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <form
      className={`sbox${q ? ' has' : ''}`}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onAsk();
      }}
    >
      <Icon name="search" size={18} className="sbox-ic" />
      <textarea
        ref={ref}
        rows={1}
        value={q}
        spellCheck={false}
        placeholder="Paste a reply or an issue link, or describe the task…"
        aria-label="Find the chat a message belongs to"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onAsk();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            if (q) onClear();
            else e.currentTarget.blur();
          }
        }}
        onPaste={(e) => {
          const el = e.currentTarget;
          // A pasted reply or link is a deliberate question: ask Claude straight away.
          // Runs after the pasted text lands in the box (a timeout, not a frame: frames pause in background tabs).
          setTimeout(() => el.value.trim().length >= 12 && onAsk(el.value), 0);
        }}
      />
      {q && (
        <button type="button" className="sbox-clear" onClick={onClear} aria-label="Clear search" title="Clear (Esc)">
          <Icon name="close" size={16} />
        </button>
      )}
      <button type="submit" className="btn primary sbox-go" disabled={!q.trim() || busy} aria-label="Ask Claude which chat this belongs to">
        {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="sparkle" size={14} />}
        <span className="sbox-go-t">Ask Claude</span>
        <kbd>↵</kbd>
      </button>
    </form>
  );
}
