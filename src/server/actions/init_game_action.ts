/*
 * Registers an API action to initialize the "game", by fetching the game data stored in redis.
 *
 * u/beach-brews
 */

import { Router } from 'express';
import { context, reddit, redis } from '@devvit/web/server';
import { Logger } from '../utils/Logger';

export const initGameAction = (router: Router): void => {
  router.get('/api/init', (_req, res) => {
    console.log('[init] GET /api/init hit');
    void (async () => {
      const logger = await Logger.Create('API - Post Init');
      logger.traceStart('API Action');

      try {
        const { postData } = context;
        const username = await reddit.getCurrentUsername();
        console.log('[init] postData', postData);

        // If no level identifier in post context (e.g. post created via "Create a new post"), return safe default
        if (!postData?.levelName || typeof postData.levelName !== 'string') {
          logger.info('API Init: no postData.levelName, returning default init');
          res.json({
            type: 'init',
            levelName: '',
            levelData: '',
            username: username ?? 'anonymous',
          });
          return;
        }

        const levelName = postData.levelName;

        // Prefer game data embedded in the post (manual "Post a level" flow). No Redis needed.
        // Support both camelCase and snake_case in case postData is serialized differently.
        const embeddedLevelData =
          postData.levelData ??
          postData.imageUrl ??
          (postData as Record<string, unknown>).level_data ??
          (postData as Record<string, unknown>).image_url;
        const embeddedLevelDataStr = typeof embeddedLevelData === 'string' ? embeddedLevelData : '';
        if (embeddedLevelDataStr.length > 0) {
          const answer =
            postData.answer ??
            (postData as Record<string, unknown>).answer;
          const celebrityName =
            postData.celebrityName ??
            (postData as Record<string, unknown>).celebrity_name;
          const answerStr = typeof answer === 'string' ? answer : answer != null ? String(answer) : '';
          const celebrityNameStr =
            typeof celebrityName === 'string' ? celebrityName : celebrityName != null ? String(celebrityName) : '';
          res.json({
            type: 'init',
            levelName,
            levelData: embeddedLevelDataStr,
            imageUrl: embeddedLevelDataStr,
            username: username ?? 'anonymous',
            ...(answerStr && { answer: answerStr }),
            ...(celebrityNameStr && { celebrityName: celebrityNameStr }),
          });
          return;
        }

        // Fallback: load from Redis (scheduler-created or legacy posts that only stored levelName)
        const levelKey = `level:${levelName}`;
        const legacyData = await redis.get(levelKey);
        if (typeof legacyData === 'string' && legacyData.length > 0) {
          res.json({
            type: 'init',
            levelName,
            levelData: legacyData,
            imageUrl: legacyData,
            username: username ?? 'anonymous',
          });
          return;
        }
        const levelHash = await redis.hGetAll(levelKey);
        const imageUrl = levelHash['imageUrl'] ?? levelHash.imageUrl;
        const levelData = typeof imageUrl === 'string' ? imageUrl : imageUrl != null ? String(imageUrl) : '';
        if (!levelData) {
          logger.info('API Init: no level data in redis for levelName, returning default init');
          res.json({
            type: 'init',
            levelName,
            levelData: '',
            username: username ?? 'anonymous',
          });
          return;
        }
        const answer = levelHash['answer'] ?? levelHash.answer;
        const celebrityName = levelHash['celebrityName'] ?? levelHash.celebrityName;
        res.json({
          type: 'init',
          levelName,
          levelData,
          imageUrl: levelData,
          username: username ?? 'anonymous',
          ...(typeof answer === 'string' && { answer }),
          ...(typeof celebrityName === 'string' && { celebrityName }),
        });

        /* ========== End Focus - Fetch from redis + return result ========== */

      } catch (error) {
        logger.error('Error in init action: ', error);
        res.status(400).json({
          status: 'error',
          message: 'Init action failed'
        });
      } finally {
        logger.traceEnd();
      }
    })();
  });
};