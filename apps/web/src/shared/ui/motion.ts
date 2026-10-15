import type { Transition } from 'framer-motion';

/** Snappy spring for things that move: cards reordering, results arriving. */
export const spring: Transition = { type: 'spring', stiffness: 520, damping: 44, mass: 0.8 };
/** Short ease for fades and small pops. */
export const ease: Transition = { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] };
