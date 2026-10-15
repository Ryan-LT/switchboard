import { useSyncExternalStore } from 'react';

/** One shared clock for every "5m ago" on the page: ticks every 30 seconds, one timer in total. */
let now = Date.now();
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(fn: () => void) {
  subs.add(fn);
  if (!timer)
    timer = setInterval(() => {
      now = Date.now();
      subs.forEach((s) => s());
    }, 30_000);
  return () => {
    subs.delete(fn);
    if (!subs.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export const useNow = () => useSyncExternalStore(subscribe, () => now);
