import '../index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { APP_THEME } from '../theme';

/** Splash image served from client public folder (same origin, no API needed) */
const SPLASH_IMAGE_SRC = '/will_smith_alternating.gif';

type LeaderboardEntry = { member: string; score: number; avatarUrl?: string };

export const Splash = () => {
  const [topScores, setTopScores] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/leaderboard', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { topScores: [] }))
      .then((data: { topScores?: LeaderboardEntry[] }) => {
        if (!cancelled && Array.isArray(data?.topScores)) {
          setTopScores(data.topScores);
        }
      })
      .catch(() => {
        if (!cancelled) setTopScores([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const highScore = topScores[0];

  return (
    <div
      className={`flex relative flex-col justify-center items-center min-h-screen ${APP_THEME.rootClassName}`}
      style={APP_THEME.rootStyle}
    >
      <div className="flex flex-col items-center gap-2 px-4">
        <h1 className="text-xl font-bold text-center text-white leading-tight">
          Are you Delulu or is it a Celulu?
        </h1>
        <img
          className="object-contain w-full max-w-[200px] mx-auto rounded-lg shadow-lg"
          src={SPLASH_IMAGE_SRC}
          alt="Will Smith Alternating"
        />
        <div className="flex flex-col items-center gap-0.5">
          <p className="text-xs text-center text-gray-400">
            Can you guess whether you're Delulu or if it's a Celulu (celebrity)?
          </p>
          <p className="text-xs text-center text-gray-400">
            Analyze the image quickly! But don't hit the obstacles or the border!
          </p>
          {highScore != null && (
            <div
              className="flex items-center justify-center gap-2 mt-2 px-3 py-2 rounded-lg w-full max-w-xs"
              style={{
                background: 'rgba(37, 45, 69, 0.85)',
                border: '1px solid rgba(61, 74, 109, 0.6)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
              }}
            >
              {highScore.avatarUrl ? (
                <img
                  src={highScore.avatarUrl}
                  alt="High scorer avatar"
                  className="flex-shrink-0 rounded-full object-cover"
                  width={24}
                  height={24}
                  style={{ borderRadius: 12 }}
                />
              ) : (
                <div
                  className="flex-shrink-0 rounded-full bg-gray-600 flex items-center justify-center text-white text-xs font-bold"
                  style={{ width: 24, height: 24 }}
                >
                  ?
                </div>
              )}
              <span className="text-white text-sm font-bold tabular-nums">
                {highScore.member}: {Math.floor(highScore.score).toLocaleString()}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-center mt-1">
          <button
            className="relative flex items-center justify-center w-auto min-w-[180px] h-12 rounded-full cursor-pointer transition-transform active:scale-[0.97] px-6 text-white font-semibold text-lg overflow-hidden"
            style={{
              background: 'linear-gradient(145deg, #7c3aed 0%, #5b21b6 50%, #4c1d95 100%)',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 14px rgba(124, 58, 237, 0.4)',
            }}
            onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
          >
            <span className="relative z-10">Tap to Start</span>
          </button>
        </div>
      </div>
      {/* <footer className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-3 text-[0.8em] text-gray-500">
        <button
          className="cursor-pointer hover:text-gray-300 transition-colors"
          onClick={() => navigateTo('https://developers.reddit.com/docs')}
        >
          Docs
        </button>
        <span className="text-gray-600">|</span>
        <button
          className="cursor-pointer hover:text-gray-300 transition-colors"
          onClick={() => navigateTo('https://www.reddit.com/r/Devvit')}
        >
          r/Devvit
        </button>
        <span className="text-gray-600">|</span>
        <button
          className="cursor-pointer hover:text-gray-300 transition-colors"
          onClick={() => navigateTo('https://discord.com/invite/R7yu2wh9Qz')}
        >
          Discord
        </button>
      </footer> */}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
