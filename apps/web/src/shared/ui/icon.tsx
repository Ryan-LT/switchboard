import type { Outcome } from '@/shared/api';

const PI: Record<string, string> = {
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h8"/>',
  box: '<path d="M3 7.5 12 3l9 4.5-9 4.5z"/><path d="M3 7.5v9L12 21l9-4.5v-9"/><path d="M12 12v9"/>',
  bag: '<path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.4c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2s1.2 1.6 2.8 1.9 2.8.8 2.8 2-1.2 2-2.8 2c-1.3 0-2.4-.5-2.9-1.4"/><path d="M12 6.5V8"/><path d="M12 16v1.5"/>',
  sparkle: '<path d="M12 3l2.3 6.2L21 12l-6.7 2.8L12 21l-2.3-6.2L3 12l6.7-2.8z"/>',
  heart: '<path d="M12 20s-7.5-4.6-9.2-9.1C1.7 7.8 3.8 5 6.9 5c2 0 3.6 1.1 5.1 3 1.5-1.9 3.1-3 5.1-3 3.1 0 5.2 2.8 4.1 5.9C19.5 15.4 12 20 12 20z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  inbox: '<path d="M3 13l3-8h12l3 8"/><path d="M3 13v6h18v-6h-5l-1.5 2.5h-5L8 13z"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="M3 13h18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  bars: '<path d="M4 20V11"/><path d="M10 20V5"/><path d="M16 20v-7"/><path d="M3 20h18"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6"/><path d="M9 16h6"/>',
  mountain: '<path d="M3 20l6.5-11 4 6.5 2.5-3.5L21 20z"/><circle cx="17" cy="6" r="2"/>',
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>',
  rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3c1-4 4.5-8.5 12-9-.5 7.5-5 11-9 12z"/><circle cx="15" cy="9" r="1.5"/>',
};
export const PROJECT_ICONS = Object.keys(PI).filter((k) => k !== 'inbox');
export const HUES = ['blue', 'orange', 'rose', 'green', 'violet', 'pink', 'indigo', 'olive', 'teal', 'cyan', 'brown', 'slate'];

const OI: Record<Outcome, string> = {
  decision: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2-2.4 3.6"/><path d="M12 17h.01"/>',
  waiting: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  progress: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',
  done: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.2 9.5"/>',
};

const EXTRA = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sparkle: PI.sparkle,
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  issue: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
  pr: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 8v8"/><path d="M18 16V9a3 3 0 0 0-3-3h-4"/><path d="M13 4l-2 2 2 2"/>',
  merged: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 8v8"/><path d="M6 8c0 3 3 4 10 4"/>',
  figma: '<path d="M9 3h3v6H9a3 3 0 0 1 0-6z"/><path d="M12 3h3a3 3 0 0 1 0 6h-3z"/><path d="M9 9h3v6H9a3 3 0 0 1 0-6z"/><circle cx="15" cy="12" r="3"/><path d="M9 15h3v3a3 3 0 1 1-3-3z"/>',
  slack: '<path d="M5 9h14"/><path d="M5 15h14"/><path d="M10 4 8 20"/><path d="M16 4l-2 16"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6"/><path d="M9 16h6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10"/><path d="M18 9c0 5-6 4-11 8"/>',
} satisfies Record<string, string>;

export type IconName = keyof typeof EXTRA;

function Svg({ d, size = 16, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}

/** Four board columns, one per outcome colour, hanging from the top like cards on a board. */
export const BrandMark = ({ size = 20 }: { size?: number }) => (
  <svg className="brand-mark" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <rect x="1.5" y="2.5" width="4.5" height="17" rx="2.25" fill="var(--input)" />
    <rect x="7" y="2.5" width="4.5" height="11" rx="2.25" fill="var(--blocked)" />
    <rect x="12.5" y="2.5" width="4.5" height="14" rx="2.25" fill="var(--run)" />
    <rect x="18" y="2.5" width="4.5" height="8" rx="2.25" fill="var(--turn)" />
  </svg>
);

export const OutcomeIcon = ({ o, size = 14 }: { o: Outcome; size?: number }) => <Svg d={OI[o]} size={size} />;
export const Icon = ({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) => <Svg d={EXTRA[name]} size={size} className={className} />;
export const ProjectGlyph = ({ icon, size = 16 }: { icon: string; size?: number }) => <Svg d={PI[icon] ?? PI.grid} size={size} />;
