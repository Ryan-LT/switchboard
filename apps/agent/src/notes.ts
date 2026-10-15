import { randomUUID } from 'node:crypto';
import type { Note } from './types.js';

/** Keeps only well-formed, non-empty notes, newest first. */
export function cleanNotes(notes: unknown, existing: Note[]): Note[] | undefined {
  // A page loaded before notes became a list still sends one string; add it instead of replacing the list.
  if (typeof notes === 'string') {
    const text = notes.trim();
    return text ? [{ id: randomUUID(), text, at: Date.now() }, ...existing.filter((n) => n.text !== text)] : existing.length ? existing : undefined;
  }
  const L = (Array.isArray(notes) ? notes : [])
    .filter((n) => n && typeof n.id === 'string' && typeof n.text === 'string' && n.text.trim() && Number.isFinite(n.at))
    .map((n): Note => ({ id: n.id, text: n.text.trim(), at: n.at, ...(Number.isFinite(n.editedAt) ? { editedAt: n.editedAt } : {}) }))
    .sort((a, b) => b.at - a.at);
  return L.length ? L : undefined;
}
