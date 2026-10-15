import { useState } from 'react';
import { api, type ImageRef, type Item } from '@/shared/api';
import { openLightbox } from '@/shared/ui';
import { titleOf } from '../model/status';

const sourceOf = (i: ImageRef) => (i.from === 'chat' ? 'Your screenshot' : i.from === 'pr' ? 'From the PR' : 'From the issue');

/** One or two pictures that remind you what the task is; a click opens all of them full size. */
export function Thumbs({ c }: { c: Item }) {
  const [broken, setBroken] = useState<string[]>([]);
  const imgs = c.images.filter((i) => !broken.includes(i.id));
  if (!imgs.length) return null;
  const shown = imgs.slice(0, 2);
  const open = (k: number) =>
    openLightbox(
      imgs.map((i) => ({ src: api.imageUrl(i.id, true), caption: i.caption, source: sourceOf(i) })),
      k,
      titleOf(c),
    );
  return (
    <div className={`thumbs n${shown.length}`}>
      {shown.map((im, k) => (
        <button key={im.id} className="thumb" onClick={() => open(k)} aria-label={`View image ${k + 1} of ${imgs.length}${im.caption ? `: ${im.caption}` : ''}`}>
          <img src={api.imageUrl(im.id)} alt="" loading="lazy" decoding="async" onError={() => setBroken((b) => [...b, im.id])} />
          {im.from !== 'chat' && <span className="thumb-src">{im.from === 'pr' ? 'PR' : 'Issue'}</span>}
          {k === shown.length - 1 && imgs.length > shown.length && <span className="thumb-more">+{imgs.length - shown.length}</span>}
        </button>
      ))}
    </div>
  );
}
