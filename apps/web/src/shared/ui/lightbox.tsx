import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { useEffect, useSyncExternalStore } from 'react';
import { Icon } from './icon';
import { ease } from './motion';

export interface LightboxImage {
  src: string;
  caption?: string;
  /** Where it came from: "From your chat", "Issue #232". */
  source?: string;
}

let state: { images: LightboxImage[]; index: number; title?: string } | null = null;
const subs = new Set<() => void>();
const set = (next: typeof state) => {
  state = next;
  subs.forEach((s) => s());
};

/** Opens the full-size viewer at `index`. */
export function openLightbox(images: LightboxImage[], index = 0, title?: string) {
  if (images.length) set({ images, index, title });
}

/** Full-size image viewer: arrows or ←/→ to move, Esc or a click outside to close. Rendered once by the app. */
export function LightboxHost() {
  const s = useSyncExternalStore(
    (fn) => (subs.add(fn), () => subs.delete(fn)),
    () => state,
  );
  const go = (d: number) => s && set({ ...s, index: (s.index + d + s.images.length) % s.images.length });

  useEffect(() => {
    if (!s) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') set(null);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const img = s?.images[s.index];
  return <AnimatePresence>{s && img && <View s={s} img={img} go={go} />}</AnimatePresence>;
}

function View({ s, img, go }: { s: NonNullable<typeof state>; img: LightboxImage; go: (d: number) => void }) {
  // While it fades out it no longer catches clicks, so the page underneath works straight away.
  const present = useIsPresent();
  return (
    <motion.div
      className="lb"
      role="dialog"
      aria-modal="true"
      aria-label={s.title ?? 'Image'}
      style={{ pointerEvents: present ? 'auto' : 'none' }}
      onClick={() => set(null)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={ease}
    >
      <button className="lb-x" aria-label="Close" onClick={() => set(null)}>
        <Icon name="close" size={20} />
      </button>
      <motion.figure key={img.src} className="lb-fig" onClick={(e) => e.stopPropagation()} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={ease}>
        <img src={img.src} alt={img.caption ?? ''} />
        <figcaption>
          {img.source && <b>{img.source}</b>}
          {img.caption && <span>{img.caption}</span>}
          {s.images.length > 1 && (
            <em>
              {s.index + 1} / {s.images.length}
            </em>
          )}
        </figcaption>
      </motion.figure>
      {s.images.length > 1 && (
        <>
          <button className="lb-nav prev" aria-label="Previous image" onClick={(e) => (e.stopPropagation(), go(-1))}>
            <Icon name="left" size={22} />
          </button>
          <button className="lb-nav next" aria-label="Next image" onClick={(e) => (e.stopPropagation(), go(1))}>
            <Icon name="right" size={22} />
          </button>
        </>
      )}
    </motion.div>
  );
}
