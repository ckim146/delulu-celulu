import { useEffect, useRef, useState } from 'react';
import { useRounds } from '../hooks/useRounds';

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
}: {
  showGuessUI: boolean;
  isZooming: boolean;
  imageUrl: string;
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
  const initialZoomStateRef = useRef<{ offset: { x: number; y: number }; sizePercent: number } | null>(null);
  const [zoomSizePercent, setZoomSizePercent] = useState<number | null>(null);
  const zoomCompletedRef = useRef(false);
  const [markers, setMarkers] = useState<Marker[]>(() => {
    const items: Marker[] = [];
    const count = 10;
    const minDistance = 5; // minimum distance in percentage units of the larger dimension

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
    while (items.length < count && attempts < 1000) {
      attempts += 1;
      const x = 10 + Math.random() * 80; // keep away from edges
      const y = 10 + Math.random() * 80;

      if (!isFarEnough(x, y, items)) continue;

      items.push({
        id: items.length,
        x,
        y,
        type: items.length % 2 === 0 ? 'obstacle' : 'powerup',
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
        sizePercent: 500, // Start at 500%
      };
      setZoomSizePercent(500);
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

        const {
          softMinX,
          softMaxX,
          softMinY,
          softMaxY,
          hardMinX,
          hardMaxX,
          hardMinY,
          hardMaxY,
        } = boundsRef.current;

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
      {/* Oversized image to allow panning */}
      <div
        ref={imageRef}
        className="absolute select-none transition-opacity duration-300"
        style={{
          width: zoomSizePercent !== null ? `${zoomSizePercent}%` : '500%',
          height: zoomSizePercent !== null ? `${zoomSizePercent}%` : '500%',
          top: '50%',
          left: '50%',
          backgroundImage: imageUrl ? `url(${imageUrl})` : "url('/snoo.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          transform: `translate(-50%, -50%) translate3d(${offset.x}px, ${offset.y}px, 0)`,
          willChange: 'transform, width, height',
          opacity: showGuessUI && !isZooming ? 0.3 : 1,
          transition: isZooming ? 'none' : undefined, // Disable transition during animation for smooth frame-by-frame updates
        }}
      >
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

export const App = () => {
  const { rounds, loading, error, currentRound } = useRounds();
  const roundImageUrl = currentRound?.imageUrl ?? '';
  const [score, setScore] = useState(100_000);
  const [showGuessUI, setShowGuessUI] = useState(false);
  const [isZooming, setIsZooming] = useState(false);

  const handleGuessButtonClick = () => {
    setShowGuessUI(true);
  };

  const handleGuess = () => {
    setShowGuessUI(false);
    setIsZooming(true);
  };

  useEffect(() => {
    // Stop score timer when guess button is pressed
    if (showGuessUI || isZooming) return;

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
  }, [showGuessUI]);

  const roundedScore = Math.floor(score);

  return (
    <div
      className="flex flex-col min-h-screen bg-black text-white"
      style={{ fontFamily: "'Quicksand', sans-serif" }}
    >
      {/* Top bar: score only */}
      <header className="px-4 py-3 flex items-center justify-center">
        <div className="flex flex-col items-center">
          <span className="text-xs uppercase tracking-wide text-gray-400">Score</span>
          <span className="text-2xl font-semibold leading-tight tabular-nums">
            {roundedScore}
          </span>
        </div>
      </header>

      {/* Reveal message: between score and canvas */}
      {isZooming && (
        <div className="px-4 py-2 flex justify-center">
          <p className="text-center text-lg font-medium text-white max-w-md">
            Congrats! It&apos;s a Celulu! (You&apos;re not Delulu)
          </p>
        </div>
      )}

      {/* Main image canvas */}
      <main className="flex-1 flex items-center justify-center px-4 pb-4 relative">
        {loading && (
          <p className="text-center text-sm text-gray-400 px-4">Loading round...</p>
        )}
        {error && !loading && (
          <p className="text-center text-sm text-amber-400 px-4">Could not load round: {error}</p>
        )}
        {!loading && !error && rounds.length === 0 && (
          <p className="text-center text-sm text-gray-400 px-4">No rounds yet. Mods can add one via the menu.</p>
        )}
        <ImageCanvas
          showGuessUI={showGuessUI}
          isZooming={isZooming}
          imageUrl={roundImageUrl}
        />
        
        {/* Guess UI overlay */}
        {showGuessUI && !isZooming && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-4 z-10">
            <p className="text-center text-lg font-medium text-white max-w-md">
              So... are you delulu or is this a celulu (celebrity)?
            </p>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              <button
                onClick={handleGuess}
                className="w-full h-12 rounded-full bg-red-500 text-white font-semibold text-base shadow-lg active:scale-[0.97] transition-transform"
              >
                Delulu
              </button>
              <button
                onClick={handleGuess}
                className="w-full h-12 rounded-full bg-blue-500 text-white font-semibold text-base shadow-lg active:scale-[0.97] transition-transform"
              >
                Celulu
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Bottom fixed answer button */}
      {!showGuessUI && !isZooming && (
        <footer className="mt-auto w-full px-4 pb-6 pt-3 bg-gradient-to-t from-black to-black/60">
          <button
            onClick={handleGuessButtonClick}
            className="w-full h-12 rounded-full bg-[#d93900] text-white font-semibold text-base shadow-lg active:scale-[0.97] transition-transform"
          >
            Guess: Altered or Original
          </button>
        </footer>
      )}
    </div>
  );
};
