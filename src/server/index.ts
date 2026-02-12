import express from 'express';
import { context, createServer, getServerPort, reddit, redis } from '@devvit/web/server';

/* ========== Start Focus - Import action files ========== */
import { menuAction } from './actions/menu_action';
import { formAction } from './actions/form_action';
import { initGameAction } from './actions/init_game_action';
/* ========== End Focus - Import action files ========== */

const app = express();

// Middleware for JSON body parsing
app.use(express.json());
// Middleware for URL-encoded body parsing
app.use(express.urlencoded({ extended: true }));
// Middleware for plain text body parsing
app.use(express.text());

const router = express.Router();

/* ========== Start Focus - Register game actions ========== */
menuAction(router);
formAction(router);
initGameAction(router);

// GET /api/ping — use to verify the server receives requests (e.g. from client or devvit logs)
router.get('/api/ping', (_req, res) => {
  console.log('[server] GET /api/ping hit');
  res.json({ ok: true });
});

// POST /api/submit-score — add username and score to leaderboard (one submission per user per post)
router.post('/api/submit-score', async (req, res) => {
  try {
    const body = req.body ?? {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const gameScore = typeof body.score === 'number' ? body.score : Number(body.score);
    const postId = typeof body.postId === 'string' ? body.postId.trim() : '';
    if (!username || Number.isNaN(gameScore)) {
      res.status(400).json({ ok: false, error: 'Missing or invalid username or score' });
      return;
    }
    if (postId) {
      const key = `post:${postId}:submitted`;
      const submitted = await redis.hGetAll(key);
      if (submitted && Object.prototype.hasOwnProperty.call(submitted, username)) {
        res.json({ ok: false, alreadySubmitted: true });
        return;
      }
      await redis.hSet(key, { [username]: '1' });
    }
    await redis.zAdd('leaderboard', {
      member: username,
      score: gameScore,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Submit score error:', err);
    res.status(500).json({ ok: false, error: 'Failed to submit score' });
  }
});

// GET /api/leaderboard — top 3 scores (descending) with avatar URLs for splash screen
router.get('/api/leaderboard', async (_req, res) => {
  try {
    const topScores = await redis.zRange('leaderboard', 0, 2, {
      by: 'rank',
      reverse: true,
    });
    const list = Array.isArray(topScores) ? topScores : [];
    const withAvatars: { member: string; score: number; avatarUrl?: string }[] = await Promise.all(
      list.map(async (entry: { member?: string; score?: number }) => {
        const member = typeof entry?.member === 'string' ? entry.member : '';
        const score = typeof entry?.score === 'number' ? entry.score : 0;
        let avatarUrl: string | undefined;
        try {
          const user = await reddit.getUserByUsername(member);
          if (user) {
            avatarUrl =
              (user as { iconUrl?: string }).iconUrl ??
              (typeof (user as { getSnoovatarUrl?: () => Promise<string> }).getSnoovatarUrl === 'function'
                ? await (user as { getSnoovatarUrl: () => Promise<string> }).getSnoovatarUrl()
                : undefined);
          }
        } catch {
          // leave avatarUrl undefined
        }
        return { member, score, ...(avatarUrl && { avatarUrl }) };
      })
    );
    res.json({ topScores: withAvatars });
  } catch (err) {
    console.error('Leaderboard fetch error:', err);
    res.status(500).json({ topScores: [] });
  }
});

// GET /api/asset-url?name=<assetName> — get Reddit-hosted URL for an image in assets/ (CSP-safe, no proxy)
router.get('/api/asset-url', (req, res) => {
  const name = req.query.name;
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Missing or invalid name query' });
    return;
  }
  try {
    const assets = (context as { assets?: { getURL: (n: string) => string } }).assets;
    const url = assets?.getURL(name.trim());
    if (!url) {
      res.status(404).json({ error: 'Asset not found or assets not available' });
      return;
    }
    res.json({ url });
  } catch (err) {
    console.error('Asset URL error:', err);
    res.status(500).json({ error: 'Failed to get asset URL' });
  }
});

// GET /api/proxy-image?url=<encoded-url> — proxy external images to satisfy CSP (img-src)
router.get('/api/proxy-image', async (req, res) => {
  const rawUrl = req.query.url;
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('http')) {
    res.status(400).send('Missing or invalid url query');
    return;
  }
  try {
    const response = await fetch(rawUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DevvitImageProxy/1.0)',
        Accept: 'image/*,*/*',
      },
    });
    if (!response.ok) {
      console.error('Proxy image upstream status:', response.status, rawUrl);
      res.status(response.status).send('Upstream image failed');
      return;
    }
    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Content-Type', contentType);
    res.send(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Proxy image error:', message, rawUrl);
    res.status(502).send('Failed to fetch image');
  }
});

// GET /api/levels — return only the latest level from queue (all its data)
router.get('/api/levels', async (_req, res) => {
  try {
    const queued = await redis.hGetAll('data:queue');
    const levelEntries = Object.entries(queued).filter(
      ([key]) => key !== 'answer' && key !== 'celebrityName'
    );
    const latestEntry = levelEntries.length > 0 ? levelEntries[levelEntries.length - 1] : null;
    const level = latestEntry
      ? {
          levelName: latestEntry[0],
          imageUrl: latestEntry[1],
          answer: queued['answer'] ?? null,
          celebrityName: queued['celebrityName'] ?? null,
        }
      : null;
    res.json({ level });
  } catch (err) {
    console.error('GET /api/levels error:', err);
    res.status(500).json({ level: null });
  }
});

/* ========== End Focus - Register game actions ========== */

// Use router middleware
app.use(router);

// Get port from environment variable with fallback
const port = getServerPort();

const server = createServer(app);
server.on('error', (err) => console.error(`server error; ${err.stack}`));
server.listen(port);