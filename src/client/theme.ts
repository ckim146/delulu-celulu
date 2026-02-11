/**
 * Shared app theme for splash and game.
 * Cave background: radial gradient (dark at edges, lighter at center like a cave opening).
 */
const CAVE_BACKGROUND = {
  background:
    'radial-gradient(ellipse 90% 70% at 50% 40%, #3d4a6d 0%, #252d45 30%, #141824 60%, #06080d 100%)',
};

export const APP_THEME = {
  /** Root container: dark background, light text, Quicksand font */
  root: {
    fontFamily: "'Quicksand', sans-serif",
    color: '#ffffff',
    ...CAVE_BACKGROUND,
  },
  /** Class names for Tailwind + cave gradient (override bg-black with gradient) */
  rootClassName: 'min-h-screen text-white',
  rootStyle: {
    fontFamily: "'Quicksand', sans-serif",
    ...CAVE_BACKGROUND,
  },
} as const;
