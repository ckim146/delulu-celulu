import express from 'express';
import { InitResponse, IncrementResponse, DecrementResponse } from '../shared/types/api';
import { redis, reddit, createServer, context, getServerPort } from '@devvit/web/server';
import { createPost } from './core/post';
import { menuAction } from './actions/menu_action';
import { formAction, ROUNDS_HASH_KEY } from './actions/form_action';

const app = express();

// Middleware for JSON body parsing
app.use(express.json());
// Middleware for URL-encoded body parsing
app.use(express.urlencoded({ extended: true }));
// Middleware for plain text body parsing
app.use(express.text());

const router = express.Router();

router.get<{ postId: string }, InitResponse | { status: string; message: string }>(
  '/api/init',
  async (_req, res): Promise<void> => {
    const { postId } = context;

    if (!postId) {
      console.error('API Init Error: postId not found in devvit context');
      res.status(400).json({
        status: 'error',
        message: 'postId is required but missing from context',
      });
      return;
    }

    try {
      const [count, username] = await Promise.all([
        redis.get('count'),
        reddit.getCurrentUsername(),
      ]);

      res.json({
        type: 'init',
        postId: postId,
        count: count ? parseInt(count) : 0,
        username: username ?? 'anonymous',
      });
    } catch (error) {
      console.error(`API Init Error for post ${postId}:`, error);
      let errorMessage = 'Unknown error during initialization';
      if (error instanceof Error) {
        errorMessage = `Initialization failed: ${error.message}`;
      }
      res.status(400).json({ status: 'error', message: errorMessage });
    }
  }
);

router.post<{ postId: string }, IncrementResponse | { status: string; message: string }, unknown>(
  '/api/increment',
  async (_req, res): Promise<void> => {
    const { postId } = context;
    if (!postId) {
      res.status(400).json({
        status: 'error',
        message: 'postId is required',
      });
      return;
    }

    res.json({
      count: await redis.incrBy('count', 1),
      postId,
      type: 'increment',
    });
  }
);

router.post<{ postId: string }, DecrementResponse | { status: string; message: string }, unknown>(
  '/api/decrement',
  async (_req, res): Promise<void> => {
    const { postId } = context;
    if (!postId) {
      res.status(400).json({
        status: 'error',
        message: 'postId is required',
      });
      return;
    }

    res.json({
      count: await redis.incrBy('count', -1),
      postId,
      type: 'decrement',
    });
  }
);

function parseRound(id: string, json: string): { id: string; imageUrl: string; answer: string; celebrityName?: string; used: boolean } | null {
  try {
    const { imageUrl, answer, celebrityName, used } = JSON.parse(json);
    return { id, imageUrl, answer, celebrityName, used: used === true };
  } catch {
    return null;
  }
}

function todayKey(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `delulu:today:${y}-${m}-${d}`;
}

router.get('/api/round', async (_req, res): Promise<void> => {
  try {
    const dateKey = todayKey();
    const existingId = await redis.get(dateKey);
    const raw = await redis.hGetAll(ROUNDS_HASH_KEY);
    const entries = Object.entries(raw ?? {});

    console.log('[api/round] dateKey:', dateKey, 'existingId:', existingId, 'raw keys:', raw ? Object.keys(raw) : [], 'entries count:', entries.length);

    const parsedRounds = entries.map(([id, json]) => parseRound(id, json));
    console.log('[api/round] parsed rounds:', parsedRounds);

    if (existingId && raw?.[existingId]) {
      const round = parseRound(existingId, raw[existingId]);
      if (round) {
        res.json({ round });
        return;
      }
    }

    const allRounds = parsedRounds.filter((r): r is NonNullable<typeof r> => r != null && !r.used);

    if (allRounds.length === 0) {
      res.status(200).json({
        round: null,
        message: 'No unused rounds available',
        debug: { totalInRedis: parsedRounds.length, dateKey },
      });
      return;
    }

    const chosen = allRounds[Math.floor(Math.random() * allRounds.length)]!;
    await redis.set(dateKey, chosen.id);

    const updated = { ...chosen, used: true };
    await redis.hSet(ROUNDS_HASH_KEY, { [chosen.id]: JSON.stringify({ imageUrl: chosen.imageUrl, answer: chosen.answer, celebrityName: chosen.celebrityName, used: true }) });

    res.json({ round: updated });
  } catch (error) {
    console.error('Error fetching today round:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load round' });
  }
});

router.get('/api/rounds', async (_req, res): Promise<void> => {
  try {
    const raw = await redis.hGetAll(ROUNDS_HASH_KEY);
    const rounds = Object.entries(raw ?? {}).map(([id, json]) => parseRound(id, json)).filter((r): r is NonNullable<typeof r> => r != null);
    res.json(rounds);
  } catch (error) {
    console.error('Error fetching rounds:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load rounds' });
  }
});

router.post('/internal/on-app-install', async (_req, res): Promise<void> => {
  try {
    const post = await createPost();

    res.json({
      status: 'success',
      message: `Post created in subreddit ${context.subredditName} with id ${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

router.post('/internal/menu/post-create', async (_req, res): Promise<void> => {
  try {
    const post = await createPost();

    res.json({
      navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

// Menu: show round-creation form (image, answer, celebrity name)
menuAction(router);
// Form: handle round-submit (persist to Redis, show toast)
formAction(router);

// Use router middleware
app.use(router);

// Get port from environment variable with fallback
const port = getServerPort();

const server = createServer(app);
server.on('error', (err) => console.error(`server error; ${err.stack}`));
server.listen(port);
