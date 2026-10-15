import { MotionConfig } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useLiveState } from '@/shared/api';
import { load, save } from '@/shared/lib';
import { BrandMark, Icon, LightboxHost, spring, Toaster } from '@/shared/ui';
import { HomePage } from '@/pages/home';

type Theme = 'system' | 'dark' | 'light';
const NEXT: Record<Theme, Theme> = { system: 'dark', dark: 'light', light: 'system' };

export function App() {
  const { data, conn, error } = useLiveState();
  const [theme, setTheme] = useState<Theme>(() => load('sb.theme', 'system'));

  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    save('sb.theme', theme);
  }, [theme]);

  return (
    // reducedMotion="user": with Reduce Motion on in macOS, everything changes instantly.
    <MotionConfig reducedMotion="user" transition={spring}>
      <header className="top">
        <div className="top-in">
          <span className="brand">
            <BrandMark size={20} />
            Claude Board
          </span>
          <span className="sp" />
          <span className={`conn c-${conn}`} title={conn === 'live' ? 'Live: updates arrive as Claude writes' : conn === 'offline' ? 'The Claude Board agent is not reachable; retrying' : 'Connecting'}>
            <i />
            {conn === 'live' ? 'Live' : conn === 'offline' ? 'Offline' : 'Connecting'}
          </span>
          <button className="btn ghost sm" onClick={() => setTheme(NEXT[theme])} title={`Theme: ${theme}`} aria-label={`Theme: ${theme}. Change theme`}>
            <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} size={15} />
          </button>
        </div>
      </header>
      {data ? (
        <HomePage data={data} />
      ) : (
        <div className="boot" role="status">
          {error ? (
            <>
              <b>Can't reach the Claude Board agent</b>
              <p>
                Start it with <code>pnpm start</code> in the switchboard folder. This page reconnects by itself.
              </p>
            </>
          ) : (
            <>
              <span className="spinner" aria-hidden="true" /> Loading your chats…
            </>
          )}
        </div>
      )}
      <Toaster />
      <LightboxHost />
    </MotionConfig>
  );
}
