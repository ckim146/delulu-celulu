import { useEffect, useRef, useState } from 'react';
import { context } from '@devvit/web/client';
import { APP_THEME } from '../theme';

type InitResponse = {
  type: 'init';
  levelName: string;
  levelData: string;
  imageUrl?: string;
  username: string;
  answer?: string;
  celebrityName?: string;
};

type LevelData = {
  levelName: string;
  imageUrl: string;
  answer: string | null;
  celebrityName: string | null;
};

const REVEAL_MESSAGES: Record<'Delulu' | 'Celulu', { correct: string; incorrect: string }> = {
  Delulu: {
    correct: "Correct! You are Delulu, that's not a Celulu!",
    incorrect: "Uh oh... looks like you were Delulu, it wasn't a Celulu!",
  },
  Celulu: {
    correct: "Correct! It's a Celulu! You're not Delulu.",
    incorrect: "Oops, you weren't Delulu. It was a Celulu!",
  },
};

type Marker = {
  id: number;
  x: number; // percentage [0,100]
  y: number; // percentage [0,100]
  type: 'obstacle' | 'powerup';
  active: boolean;
};

const ImageCanvas = ({
  showGuessUI,
  isZooming,
  imageUrl,
  onMarkerHit,
}: {
  showGuessUI: boolean;
  isZooming: boolean;
  imageUrl: string;
  onMarkerHit?: (type: 'obstacle' | 'powerup') => void;
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLDivElement | null>(null);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [arrowRotation, setArrowRotation] = useState(0);
  const [hitColor, setHitColor] = useState<'none' | 'red' | 'blue'>('none');
  const hitTimeoutRef = useRef<number | null>(null);
  const [edgeHit, setEdgeHit] = useState(false);
  const edgeHitTimeoutRef = useRef<number | null>(null);
  const zoomAnimationRef = useRef<number | null>(null);
  const initialZoomStateRef = useRef<{
    offset: { x: number; y: number };
    sizePercent: number;
  } | null>(null);
  const [zoomSizePercent, setZoomSizePercent] = useState<number | null>(null);
  const zoomCompletedRef = useRef(false);
  const ZOOM_PERCENT = 600;

  const [markers, setMarkers] = useState<Marker[]>(() => {
    const items: Marker[] = [];
    const count = 50; // ~5x density (was 10)
    const minDistance = 5;

    const isFarEnough = (x: number, y: number, existing: Marker[]) => {
      for (const m of existing) {
        const dx = x - m.x;
        const dy = y - m.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistance * minDistance) {
          return false;
        }
      }
      return true;
    };

    let attempts = 0;
    while (items.length < count && attempts < 3000) {
      attempts += 1;
      const x = 10 + Math.random() * 80; // keep away from edges
      const y = 10 + Math.random() * 80;

      if (!isFarEnough(x, y, items)) continue;

      items.push({
        id: items.length,
        x,
        y,
        type: items.length % 5 < 2 ? 'obstacle' : 'powerup',
        active: true,
      });
    }

    return items;
  });

  const isDraggingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0, t: 0 });
  const velocityRef = useRef({ vx: 0, vy: 0 });
  const boundsRef = useRef({
    softMinX: 0,
    softMaxX: 0,
    softMinY: 0,
    softMaxY: 0,
    hardMinX: 0,
    hardMaxX: 0,
    hardMinY: 0,
    hardMaxY: 0,
  });
  const animationRef = useRef<number | null>(null);
  const imageSizeRef = useRef({ width: 0, height: 0 });
  const canvasSizeRef = useRef({ width: 0, height: 0 });

  const clampOffset = (x: number, y: number) => {
    const { hardMinX, hardMaxX, hardMinY, hardMaxY } = boundsRef.current;
    return {
      x: Math.min(Math.max(x, hardMinX), hardMaxX),
      y: Math.min(Math.max(y, hardMinY), hardMaxY),
    };
  };

  const computeBounds = () => {
    if (!containerRef.current || !imageRef.current) return;
    const c = containerRef.current.getBoundingClientRect();
    const i = imageRef.current.getBoundingClientRect();

    canvasSizeRef.current = { width: c.width, height: c.height };
    imageSizeRef.current = { width: i.width, height: i.height };

    // We treat the image as centered under the arrow. The maximum offset before
    // the arrow reaches an image edge depends on how much larger the image is
    // than the canvas in each axis.
    const halfExcessX = Math.max(0, (i.width - c.width) / 2);
    const halfExcessY = Math.max(0, (i.height - c.height) / 2);

    // Soft bounds: when the arrow is exactly at the image edge.
    const softMinX = -halfExcessX;
    const softMaxX = halfExcessX;
    const softMinY = -halfExcessY;
    const softMaxY = halfExcessY;

    // Hard bounds: allow overshoot beyond the image edge so black background shows.
    // Tie overshoot to the canvas size so the feel is consistent across zoom levels.
    const overshootX = c.width * 0.5; // 50% of canvas width
    const overshootY = c.height * 0.5; // 50% of canvas height

    const hardMinX = softMinX - overshootX;
    const hardMaxX = softMaxX + overshootX;
    const hardMinY = softMinY - overshootY;
    const hardMaxY = softMaxY + overshootY;

    boundsRef.current = {
      softMinX,
      softMaxX,
      softMinY,
      softMaxY,
      hardMinX,
      hardMaxX,
      hardMinY,
      hardMaxY,
    };

    setOffset((prev) => clampOffset(prev.x, prev.y));
  };

  const triggerHitGlow = (type: 'obstacle' | 'powerup') => {
    const color = type === 'obstacle' ? 'red' : 'blue';
    setHitColor(color);

    if (hitTimeoutRef.current !== null) {
      window.clearTimeout(hitTimeoutRef.current);
    }

    hitTimeoutRef.current = window.setTimeout(() => {
      setHitColor('none');
    }, 1000);
  };

  const handleCollisions = (nextX: number, nextY: number) => {
    const { width: imgW, height: imgH } = imageSizeRef.current;
    if (!imgW || !imgH) return;

    const collisionRadius = 24; // pixels
    const radiusSq = collisionRadius * collisionRadius;

    setMarkers((prev) => {
      let hitType: 'obstacle' | 'powerup' | null = null;

      const updated = prev.map((m) => {
        if (!m.active) return m;

        const dx = ((m.x - 50) / 100) * imgW + nextX;
        const dy = ((m.y - 50) / 100) * imgH + nextY;

        if (dx * dx + dy * dy <= radiusSq) {
          hitType = m.type;
          return { ...m, active: false };
        }

        return m;
      });

      if (hitType) {
        // Visual feedback
        triggerHitGlow(hitType);
        onMarkerHit?.(hitType);

        // Modify velocity based on marker type
        let { vx, vy } = velocityRef.current;
        const speed = Math.hypot(vx, vy) || 1;

        if (hitType === 'obstacle') {
          // Red: strongly dampen movement
          const dampingFactor = 0.15;
          vx *= dampingFactor;
          vy *= dampingFactor;
        } else if (hitType === 'powerup') {
          // Blue: strongly accelerate in current direction
          const boostFactor = 2.3;
          vx *= boostFactor;
          vy *= boostFactor;

          // Cap maximum speed to avoid going wild
          const maxSpeed = 1.8; // px per ms
          const newSpeed = Math.hypot(vx, vy);
          if (newSpeed > maxSpeed) {
            const scale = maxSpeed / newSpeed;
            vx *= scale;
            vy *= scale;
          }
        }

        // If for some reason we had zero velocity, nudge slightly outward so effect is visible
        if (!Number.isFinite(vx) || !Number.isFinite(vy) || speed === 0) {
          vx = 0.45;
          vy = 0.45;
        }

        velocityRef.current = { vx, vy };
      }

      return updated;
    });
  };

  useEffect(() => {
    computeBounds();
    window.addEventListener('resize', computeBounds);
    return () => {
      window.removeEventListener('resize', computeBounds);
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      if (zoomAnimationRef.current !== null) {
        cancelAnimationFrame(zoomAnimationRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isZooming) {
      initialZoomStateRef.current = null;
      // Only reset if zoom hasn't completed yet
      if (!zoomCompletedRef.current) {
        setZoomSizePercent(null);
      }
      return;
    }

    // Reset completion flag when starting new zoom
    zoomCompletedRef.current = false;

    // Capture initial state when zoom starts (only once)
    if (initialZoomStateRef.current === null) {
      initialZoomStateRef.current = {
        offset: { ...offset },
        sizePercent: ZOOM_PERCENT, // Start at 500%
      };
      setZoomSizePercent(ZOOM_PERCENT);
    }

    const startTime = performance.now();
    const duration = 800; // 800ms animation
    const startOffset = initialZoomStateRef.current.offset;
    const startSizePercent = initialZoomStateRef.current.sizePercent;
    const endOffset = { x: 0, y: 0 };
    const endSizePercent = 100; // End at 100%

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);

      const currentOffset = {
        x: startOffset.x + (endOffset.x - startOffset.x) * eased,
        y: startOffset.y + (endOffset.y - startOffset.y) * eased,
      };

      const currentSizePercent = startSizePercent + (endSizePercent - startSizePercent) * eased;

      setOffset(currentOffset);
      setZoomSizePercent(currentSizePercent);

      if (progress < 1) {
        zoomAnimationRef.current = requestAnimationFrame(animate);
      } else {
        zoomAnimationRef.current = null;
        initialZoomStateRef.current = null;
        // Keep at 100% after animation completes
        zoomCompletedRef.current = true;
        setZoomSizePercent(100);
      }
    };

    zoomAnimationRef.current = requestAnimationFrame(animate);

    return () => {
      if (zoomAnimationRef.current !== null) {
        cancelAnimationFrame(zoomAnimationRef.current);
        zoomAnimationRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isZooming]);

  const startMomentum = () => {
    const friction = 0.0018; // higher -> stops faster
    const bounceDamping = 0.4; // 0–1, lower = less bounce

    // Set arrow direction based on current velocity
    const { vx: initialVx, vy: initialVy } = velocityRef.current;
    if (Math.abs(initialVx) > 0.01 || Math.abs(initialVy) > 0.01) {
      const angleRad = Math.atan2(initialVy, initialVx);
      const angleDeg = (angleRad * 180) / Math.PI;
      // Our arrow graphic points to the right by default; invert to match fling direction
      setArrowRotation(angleDeg + 180);
    }

    const step = (lastTime: number) => {
      const now = performance.now();
      const dt = now - lastTime;

      let { vx, vy } = velocityRef.current;

      if (Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) {
        animationRef.current = null;
        return;
      }

      setOffset((prev) => {
        let nextX = prev.x + vx * dt;
        let nextY = prev.y + vy * dt;

        const { softMinX, softMaxX, softMinY, softMaxY, hardMinX, hardMaxX, hardMinY, hardMaxY } =
          boundsRef.current;

        // Horizontal bounds with bounce at the image edge (soft), but allow overshoot (hard)
        if (nextX > softMaxX) {
          nextX = softMaxX;
          vx = -vx * bounceDamping;
          if (!edgeHit) {
            setEdgeHit(true);
            if (edgeHitTimeoutRef.current !== null) {
              window.clearTimeout(edgeHitTimeoutRef.current);
            }
            edgeHitTimeoutRef.current = window.setTimeout(() => setEdgeHit(false), 200);
          }
        } else if (nextX < softMinX) {
          nextX = softMinX;
          vx = -vx * bounceDamping;
          if (!edgeHit) {
            setEdgeHit(true);
            if (edgeHitTimeoutRef.current !== null) {
              window.clearTimeout(edgeHitTimeoutRef.current);
            }
            edgeHitTimeoutRef.current = window.setTimeout(() => setEdgeHit(false), 200);
          }
        }

        // Vertical bounds with bounce at the image edge (soft), but allow overshoot (hard)
        if (nextY > softMaxY) {
          nextY = softMaxY;
          vy = -vy * bounceDamping;
          if (!edgeHit) {
            setEdgeHit(true);
            if (edgeHitTimeoutRef.current !== null) {
              window.clearTimeout(edgeHitTimeoutRef.current);
            }
            edgeHitTimeoutRef.current = window.setTimeout(() => setEdgeHit(false), 200);
          }
        } else if (nextY < softMinY) {
          nextY = softMinY;
          vy = -vy * bounceDamping;
          if (!edgeHit) {
            setEdgeHit(true);
            if (edgeHitTimeoutRef.current !== null) {
              window.clearTimeout(edgeHitTimeoutRef.current);
            }
            edgeHitTimeoutRef.current = window.setTimeout(() => setEdgeHit(false), 200);
          }
        }

        // Final clamp to hard bounds so it can't fly away entirely
        nextX = Math.min(Math.max(nextX, hardMinX), hardMaxX);
        nextY = Math.min(Math.max(nextY, hardMinY), hardMaxY);

        velocityRef.current = { vx, vy };

        const next = { x: nextX, y: nextY };
        handleCollisions(next.x, next.y);
        return next;
      });

      const decay = Math.exp(-friction * dt);
      vx *= decay;
      vy *= decay;
      velocityRef.current = { vx, vy };

      animationRef.current = requestAnimationFrame(() => step(now));
    };

    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
    }
    animationRef.current = requestAnimationFrame(() => step(performance.now()));
  };

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    if (!(e.target instanceof HTMLElement)) return;

    isDraggingRef.current = true;
    lastPointerRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    velocityRef.current = { vx: 0, vy: 0 };

    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();

    const now = performance.now();
    const last = lastPointerRef.current;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    const dt = now - last.t || 16;

    setOffset((prev) => {
      const next = clampOffset(prev.x + dx, prev.y + dy);
      handleCollisions(next.x, next.y);
      return next;
    });

    velocityRef.current = {
      vx: dx / dt,
      vy: dy / dt,
    };

    lastPointerRef.current = { x: e.clientX, y: e.clientY, t: now };
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore if capture wasn't set
    }
    startMomentum();
  };

  const handlePointerUp: React.PointerEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    endDrag(e);
  };

  const handlePointerLeave: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    endDrag(e);
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full max-w-sm aspect-square overflow-hidden rounded-2xl bg-gray-900 border shadow-lg touch-none transition-shadow ${
        edgeHit ? 'border-red-400 shadow-[0_0_22px_rgba(248,113,113,0.85)]' : 'border-gray-700'
      }`}
      aria-label="Zoomed-in celebrity image canvas"
      onPointerDown={isZooming ? undefined : handlePointerDown}
      onPointerMove={isZooming ? undefined : handlePointerMove}
      onPointerUp={isZooming ? undefined : handlePointerUp}
      onPointerLeave={isZooming ? undefined : handlePointerLeave}
      style={{ pointerEvents: isZooming ? 'none' : 'auto' }}
    >
      {/* Oversized image to allow panning — image from init (levelData) loaded here */}
      <div
        ref={imageRef}
        className="absolute select-none transition-opacity duration-300"
        style={{
          width: zoomSizePercent !== null ? `${zoomSizePercent}%` : `${ZOOM_PERCENT}%`,
          height: zoomSizePercent !== null ? `${zoomSizePercent}%` : `${ZOOM_PERCENT}%`,
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) translate3d(${offset.x}px, ${offset.y}px, 0)`,
          willChange: 'transform, width, height',
          transition: isZooming ? 'none' : undefined,
        }}
      >
        {/* Canvas image: loaded from init levelData when present, else fallback */}
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover object-center select-none"
            style={{
              opacity: showGuessUI && !isZooming ? 0.3 : 1,
            }}
            draggable={false}
          />
        ) : (
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: "url('/snoo.png')" }}
          />
        )}
        {/* Obstacles (red) and powerups (blue) scattered across the canvas */}
        {markers.map((marker) =>
          marker.active && !showGuessUI && !isZooming ? (
            <div
              key={marker.id}
              className={`absolute w-6 h-6 rounded-full border border-white/40 shadow-md flex items-center justify-center text-xs font-bold text-white ${
                marker.type === 'obstacle' ? 'bg-red-500' : 'bg-blue-500'
              }`}
              style={{
                left: `${marker.x}%`,
                top: `${marker.y}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              {marker.type === 'obstacle' ? '!' : '⇡'}
            </div>
          ) : null
        )}
      </div>

      {/* Direction arrow */}
      {!showGuessUI && !isZooming && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className={`w-10 h-10 flex items-center justify-center rounded-full bg-black/60 backdrop-blur-sm border-2 transition-transform duration-300 ease-out transition-colors transition-shadow transition-opacity ${
              hitColor === 'red'
                ? 'border-red-400 shadow-[0_0_18px_rgba(248,113,113,0.9)]'
                : hitColor === 'blue'
                  ? 'border-blue-400 shadow-[0_0_18px_rgba(59,130,246,0.9)]'
                  : 'border-white/30 shadow-none'
            }`}
            style={{
              transform: `rotate(${arrowRotation}deg)`,
              opacity: hitColor === 'none' ? 0.6 : 1,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              className="text-white"
              style={{ transform: 'translateX(1px)' }}
            >
              <path d="M5 4l11 8-11 8V4z" fill="currentColor" />
            </svg>
          </div>
        </div>
      )}

      {/* Subtle overlay for contrast */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/40 to-transparent" />
    </div>
  );
};

/**
 * Reads level data from the current post's context when the app is running inside a custom game post.
 *
 * Devvit provides `context.postData` on the client with the custom data that was attached to the
 * post at creation time (e.g. when using "Post a level"). Using this here lets the image and
 * answer load immediately without waiting for the /api/init request, which may not receive the
 * same post context on the server.
 *
 * Supports both camelCase (levelData, imageUrl) and snake_case (level_data, image_url) keys in
 * case the platform serializes postData differently.
 *
 * @returns Level fields (levelName, levelData, answer, celebrityName) or nulls if not in a post
 *   context or postData is missing/invalid.
 */
function getLevelDataFromPostContext(): {
  levelName: string | null;
  levelData: string | null;
  answer: string | null;
  celebrityName: string | null;
} {
  try {
    // Guard: context may be undefined in some environments (e.g. dev or outside post)
    const ctx = typeof context !== 'undefined' ? context : null;
    const pd = (ctx as { postData?: Record<string, unknown> } | null)?.postData;

    if (!pd || typeof pd !== 'object') {
      return { levelName: null, levelData: null, answer: null, celebrityName: null };
    }

    // Level name: prefer camelCase, fall back to snake_case
    const levelName =
      (typeof pd.levelName === 'string' ? pd.levelName : null) ??
      (typeof (pd as Record<string, unknown>).level_name === 'string' ? (pd as Record<string, unknown>).level_name as string : null);

    // Image URL may be stored as levelData or imageUrl (camelCase or snake_case); normalize to trimmed string
    const levelDataRaw =
      pd.levelData ?? pd.imageUrl ?? (pd as Record<string, unknown>).level_data ?? (pd as Record<string, unknown>).image_url;
    const levelData =
      typeof levelDataRaw === 'string' && levelDataRaw.trim()
        ? levelDataRaw.trim()
        : null;

    // Answer (Delulu/Celulu): prefer camelCase, fall back to snake_case
    const answer =
      (typeof pd.answer === 'string' ? pd.answer : null) ??
      (typeof (pd as Record<string, unknown>).answer === 'string' ? (pd as Record<string, unknown>).answer as string : null);

    // Celebrity name: prefer camelCase, fall back to snake_case
    const celebrityName =
      (typeof pd.celebrityName === 'string' ? pd.celebrityName : null) ??
      (typeof (pd as Record<string, unknown>).celebrity_name === 'string' ? (pd as Record<string, unknown>).celebrity_name as string : null);

    return { levelName: levelName ?? null, levelData, answer, celebrityName };
  } catch {
    return { levelName: null, levelData: null, answer: null, celebrityName: null };
  }
}

const initialPostContext = getLevelDataFromPostContext();

export const App = () => {
  const [initState, setInitState] = useState<{
    levelName: string | null;
    levelData: string | null;
    username: string | null;
    answer: string | null;
    celebrityName: string | null;
    loading: boolean;
    error: boolean;
  }>({
    levelName: initialPostContext.levelName,
    levelData: initialPostContext.levelData,
    username: null,
    answer: initialPostContext.answer,
    celebrityName: initialPostContext.celebrityName,
    loading: true,
    error: false,
  });

  const [levelState, setLevelState] = useState<{
    level: LevelData | null;
    loading: boolean;
    error: boolean;
  }>({
    level: null,
    loading: true,
    error: false,
  });

  useEffect(() => {
    const init = async () => {
      try {
        console.log('[App] calling /api/init');
        const res = await fetch('/api/init', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: InitResponse = await res.json();
        if (data.type !== 'init') throw new Error('Unexpected response');
        const imageUrlFromInit = (data.levelData ?? data.imageUrl ?? '').trim() || null;
        setInitState((prev) => ({
          levelName: prev.levelName ?? (data.levelName || null),
          levelData: prev.levelData ?? imageUrlFromInit,
          username: data.username,
          answer: prev.answer ?? (typeof data.answer === 'string' ? data.answer : null),
          celebrityName: prev.celebrityName ?? (typeof data.celebrityName === 'string' ? data.celebrityName : null),
          loading: false,
          error: false,
        }));
      } catch (err) {
        console.error('Failed to init', err);
        setInitState((prev) => ({ ...prev, loading: false, error: true }));
      }
    };
    void init();
  }, []);

  // Only fetch /api/levels when init did not return level data (e.g. post created without a level).
  // For manually created game posts, we use init (postData) only.
  useEffect(() => {
    console.log('app loading');
    if (initState.loading) return;
    console.log('[App] initState.loading', initState);
    if (initState.levelData) {
      console.log('[App] initState.levelData', initState.levelData);
      setLevelState({ level: null, loading: false, error: false });
      return;
    }
    const loadLatestLevel = async () => {
      setLevelState((prev) => ({ ...prev, loading: true, error: false }));
      try {
        const res = await fetch('/api/levels');
        const data = await res.json().catch(() => ({}));
        const raw = data.level ?? null;
        if (raw && typeof raw.levelName === 'string' && typeof raw.imageUrl === 'string') {
          setLevelState({
            level: {
              levelName: raw.levelName,
              imageUrl: raw.imageUrl,
              answer: raw.answer ?? null,
              celebrityName: raw.celebrityName ?? null,
            },
            loading: false,
            error: false,
          });
        } else {
          setLevelState({ level: null, loading: false, error: false });
        }
      } catch (err) {
        console.error('Failed to fetch latest level:', err);
        setLevelState((prev) => ({ ...prev, level: null, loading: false, error: true }));
      }
    };
    void loadLatestLevel();
  }, [initState.loading, initState.levelData]);

  const { levelData, answer: initAnswer, loading: initLoading, error: initError } = initState;
  const { level, loading: levelLoading, error: levelError } = levelState;
  // Prefer init (postData) when this post was created with a level; fall back to /api/levels only when init has no levelData.
  const rawImageUrl = initState.levelData
    ? initState.levelData
    : (level?.imageUrl ?? levelData ?? '');
  console.log('[App] rawImageUrl', rawImageUrl);

  // CSP connect-src only allows: 'self', webview.devvit.net, *.redd.it, *.redditmedia.com, *.redditstatic.com, blob:
  // So we cannot fetch() external URLs (e.g. Wikipedia). Only Reddit URLs work for direct use or client fetch.
  const isHttpUrl = Boolean(rawImageUrl && /^https?:\/\//i.test(rawImageUrl));
  const isAssetName = Boolean(rawImageUrl && !/^https?:\/\//i.test(rawImageUrl));
  const isCspAllowedOrigin = (url: string) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return (
        host.endsWith('.redd.it') ||
        host.endsWith('.redditmedia.com') ||
        host.endsWith('.redditstatic.com')
      );
    } catch {
      return false;
    }
  };
  const useDirectUrl = isHttpUrl && isCspAllowedOrigin(rawImageUrl);
  const blockedByCsp = isHttpUrl && !isCspAllowedOrigin(rawImageUrl);

  type ImageLoadError = { code: string; status?: number; message?: string };
  const [resolvedImageUrl, setResolvedImageUrl] = useState('');
  const [imageLoadError, setImageLoadError] = useState<ImageLoadError | null>(null);
  useEffect(() => {
    if (useDirectUrl) {
      setResolvedImageUrl(rawImageUrl);
      setImageLoadError(null);
      return;
    }
    if (blockedByCsp) {
      setResolvedImageUrl('');
      setImageLoadError({
        code: 'csp_connect_src',
        message:
          "This domain isn't allowed by the app's security policy (connect-src). Use a Reddit image URL or add the image to assets.",
      });
      return;
    }
    if (isAssetName) {
      setResolvedImageUrl('');
      setImageLoadError(null);
      let cancelled = false;
      fetch(`/api/asset-url?name=${encodeURIComponent(rawImageUrl)}`, { credentials: 'include' })
        .then((res) => {
          if (!res.ok) {
            if (!cancelled)
              setImageLoadError({
                code: 'asset_http',
                status: res.status,
                message: res.statusText,
              });
            return Promise.reject(new Error('Asset not found'));
          }
          return res.json();
        })
        .then((data: { url?: string }) => {
          if (!cancelled && data.url) {
            setResolvedImageUrl(data.url);
            setImageLoadError(null);
          }
        })
        .catch(() => {
          if (!cancelled) setResolvedImageUrl('');
        });
      return () => {
        cancelled = true;
      };
    }
    setResolvedImageUrl(rawImageUrl);
    setImageLoadError(null);
  }, [rawImageUrl, useDirectUrl, blockedByCsp, isAssetName]);

  const imageUrl = useDirectUrl ? rawImageUrl : isAssetName ? resolvedImageUrl : rawImageUrl;
  const showExternalUrlMessage =
    blockedByCsp || (imageLoadError != null && isHttpUrl && !useDirectUrl);
  const errorDetail =
    imageLoadError?.code === 'http' && imageLoadError.status != null
      ? `HTTP ${imageLoadError.status}${imageLoadError.message ? `: ${imageLoadError.message}` : ''}`
      : imageLoadError?.code === 'csp_connect_src'
        ? 'Domain blocked by security policy (connect-src). Use a Reddit image URL (i.redd.it, redditmedia.com) or add the image to the assets folder.'
        : imageLoadError?.code === 'network_or_cors'
          ? 'Network error or CORS blocked (try a Reddit image URL or assets)'
          : (imageLoadError?.message ?? imageLoadError?.code ?? null);
  const loading = initLoading || levelLoading;
  const error = initError || levelError;
  const imageReady = Boolean(imageUrl) && !loading && !error && !showExternalUrlMessage;

  const [score, setScore] = useState(100_000);
  const [showGuessUI, setShowGuessUI] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const [userGuess, setUserGuess] = useState<'Delulu' | 'Celulu' | null>(null);
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const [scoreSubmitting, setScoreSubmitting] = useState(false);
  /** Countdown before gameplay: 3, 2, 1 then null (game starts). Starts once when image is ready. */
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownStartedRef = useRef(false);

  const handleGuessButtonClick = () => {
    setShowGuessUI(true);
  };

  const handleGuess = (guess: 'Delulu' | 'Celulu') => {
    setUserGuess(guess);
    setShowGuessUI(false);
    setIsZooming(true);
  };

  const answerFromInit = initAnswer === 'Delulu' || initAnswer === 'Celulu' ? initAnswer : null;
  const answerFromLevel =
    level?.answer === 'Delulu' || level?.answer === 'Celulu' ? level.answer : null;
  const correctAnswer = initState.levelData ? answerFromInit : answerFromLevel;
  const gotItCorrect = userGuess !== null && correctAnswer !== null && userGuess === correctAnswer;
  const revealMessage =
    correctAnswer != null && userGuess != null
      ? REVEAL_MESSAGES[correctAnswer][gotItCorrect ? 'correct' : 'incorrect']
      : "Correct! It's a Celulu! You're not Delulu.";

  // Start countdown once when image becomes ready
  useEffect(() => {
    if (imageReady && !countdownStartedRef.current) {
      countdownStartedRef.current = true;
      setCountdown(3);
    }
  }, [imageReady]);

  // Countdown tick: 3 -> 2 -> 1 -> null (game start)
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const t = setTimeout(() => {
      setCountdown((c) => (c !== null && c > 1 ? c - 1 : null));
    }, 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    // Only run score timer after countdown has finished (not during load or 3-2-1)
    if (!countdownStartedRef.current || countdown !== null || showGuessUI || isZooming) return;

    let animationId: number | null = null;
    let lastTime = performance.now();

    const tick = () => {
      const now = performance.now();
      const dt = now - lastTime;
      lastTime = now;

      setScore((prev) => {
        if (prev <= 0) return 0;
        const next = prev - dt;
        return next > 0 ? next : 0;
      });

      animationId = requestAnimationFrame(tick);
    };

    animationId = requestAnimationFrame(tick);

    return () => {
      if (animationId !== null) cancelAnimationFrame(animationId);
    };
  }, [countdown, showGuessUI]);

  const roundedScore = Math.floor(score);

  const rootStyle = {
    ...APP_THEME.rootStyle,
    backgroundImage: 'url(/delulu-celulu-bg-small.gif)',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };

  const handleSubmitScore = async () => {
    const username = initState.username ?? 'anonymous';
    setScoreSubmitting(true);
    try {
      const res = await fetch('/api/submit-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, score: roundedScore }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) setScoreSubmitted(true);
    } finally {
      setScoreSubmitting(false);
    }
  };

  return (
    <div className={`flex flex-col ${APP_THEME.rootClassName}`} style={rootStyle}>
      {/* Top bar: score only */}
      <header className="px-4 py-3 flex items-center justify-center">
        <div className="flex flex-col items-center">
          <span className="text-xs uppercase tracking-wide text-gray-400">Score</span>
          <span className="text-2xl font-semibold leading-tight tabular-nums">{roundedScore}</span>
        </div>
      </header>

      {/* Reveal message: between score and canvas */}
      {isZooming && (
        <div className="px-4 py-2 flex justify-center">
          <p className="text-center text-lg font-medium text-white max-w-md">{revealMessage}</p>
        </div>
      )}

      {/* Main: show only Loading or error until image is ready; then show canvas */}
      <main className="flex-1 flex items-center justify-center px-4 pb-4 relative">
        {!imageReady && (
          <div className="flex flex-col items-center justify-center gap-3 text-center px-4">
            {loading && <p className="text-sm text-gray-400">Loading...</p>}
            {error && !loading && (
              <p className="text-sm text-amber-400">
                Could not load: init failed. Try refreshing and trying again.
              </p>
            )}
            {showExternalUrlMessage && !loading && (
              <div className="text-sm text-amber-400/90 space-y-2 max-w-sm">
                <p>
                  {errorDetail ? (
                    <>
                      Image failed: <strong>{errorDetail}</strong>
                    </>
                  ) : (
                    <>Loading image…</>
                  )}
                </p>
                <p className="text-amber-400/70 text-xs">
                  Use a <strong>Reddit image URL</strong> (i.redd.it, redditmedia.com) or add the
                  image to <strong>assets</strong> and use its filename. Try refreshing and trying
                  again.
                </p>
              </div>
            )}
          </div>
        )}
        {imageReady && (
          <>
            <ImageCanvas
              showGuessUI={showGuessUI}
              isZooming={isZooming}
              imageUrl={imageUrl}
              onMarkerHit={(type) =>
                setScore((prev) => (type === 'powerup' ? prev + 500 : Math.max(0, prev - 500)))
              }
            />
            {/* Countdown overlay: 3, 2, 1 then game starts */}
            {countdown !== null && countdown > 0 && (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center bg-black"
                aria-live="polite"
                aria-label={`Countdown ${countdown}`}
              >
                <span className="text-white text-8xl font-bold tabular-nums drop-shadow-lg">
                  {countdown}
                </span>
              </div>
            )}
            {showGuessUI && !isZooming && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-4 z-10">
                <p className="text-center text-lg font-medium text-white max-w-md">
                  So... are you delulu or is this a celulu (celebrity)?
                </p>
                <div className="flex flex-col gap-3 w-full max-w-xs">
                  <button
                    onClick={() => handleGuess('Delulu')}
                    className="w-full h-12 rounded-full bg-red-500 text-white font-semibold text-base shadow-lg active:scale-[0.97] transition-transform"
                  >
                    Delulu
                  </button>
                  <button
                    onClick={() => handleGuess('Celulu')}
                    className="w-full h-12 rounded-full bg-blue-500 text-white font-semibold text-base shadow-lg active:scale-[0.97] transition-transform"
                  >
                    Celulu
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Bottom: Guess button (during game) or Submit score button (after reveal); hidden during countdown */}
      {imageReady && countdown === null && !showGuessUI && !isZooming && (
        <footer className="mt-auto w-full px-4 pb-6 pt-3 bg-gradient-to-t from-black to-black/60">
          <button
            onClick={handleGuessButtonClick}
            className="w-full h-12 rounded-full bg-[#d93900] text-white font-semibold text-base shadow-lg active:scale-[0.97] transition-transform"
          >
            Guess!
          </button>
        </footer>
      )}
      {imageReady && countdown === null && isZooming && (
        <footer className="mt-auto w-full px-4 pb-6 pt-3 bg-gradient-to-t from-black to-black/60">
          <button
            type="button"
            onClick={handleSubmitScore}
            disabled={scoreSubmitted || scoreSubmitting}
            className="w-full h-12 rounded-full bg-[#d93900] text-white font-semibold text-base shadow-lg disabled:opacity-60 disabled:pointer-events-none active:scale-[0.97] transition-transform"
          >
            {scoreSubmitting
              ? 'Submitting…'
              : scoreSubmitted
                ? 'Score submitted!'
                : 'Submit score'}
          </button>
        </footer>
      )}
    </div>
  );
};
