import { AnimatePresence, motion } from 'framer-motion';
import { useSyncExternalStore } from 'react';
import { ease } from './motion';

interface Toast {
  id: number;
  msg: string;
  action?: { label: string; run: () => void };
}

let toasts: Toast[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

const dismiss = (id: number) => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};

/** Shows a short message at the bottom of the page; with an action (Undo) it stays a little longer. */
export function toast(msg: string, action?: Toast['action']) {
  const id = ++seq;
  toasts = [...toasts.slice(-2), { id, msg, action }];
  emit();
  setTimeout(() => dismiss(id), action ? 7000 : 4200);
}

export function Toaster() {
  const list = useSyncExternalStore(
    (fn) => (subs.add(fn), () => subs.delete(fn)),
    () => toasts,
  );
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false} mode="popLayout">
        {list.map((t) => (
          <motion.div
            key={t.id}
            layout
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, transition: ease }}
          >
            <span>{t.msg}</span>
            {t.action && (
              <button
                className="toast-btn"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
