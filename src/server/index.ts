import express from 'express';
import { context, createServer, getServerPort, redis } from '@devvit/web/server';

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