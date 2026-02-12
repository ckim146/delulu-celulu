/*
 * Registers an action for a subreddit level menu. This menu is defined in the devvit.json.
 * See https://developers.reddit.com/docs/capabilities/client/menu-actions
 *
 * u/beach-brews
 */

import { Router } from 'express';
import { redis } from '@devvit/web/server';
import { Logger } from '../utils/Logger';

const QUEUE_KEY = 'data:queue';
const PENDING_DELETE_KEY = 'delulu:pending-delete';
const META_KEYS = ['answer', 'celebrityName'];

export const menuAction = (router: Router): void => {
  router.post(
    '/internal/menu/manage-levels',
    async (_req, res): Promise<void> => {
      const logger = await Logger.Create('Menu - Manage Levels');
      logger.traceStart('Menu Action');
      try {
        let raw = await redis.hGetAll(QUEUE_KEY);
        const pendingRaw = await redis.get(PENDING_DELETE_KEY);
        const pendingLevelName =
          typeof pendingRaw === 'string' && pendingRaw.length > 0 ? pendingRaw : null;
        if (pendingLevelName) {
          const rest: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw)) {
            if (k === pendingLevelName) continue;
            const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
            if (s != null) rest[k] = s;
          }
          await redis.del(QUEUE_KEY);
          if (Object.keys(rest).length > 0) await redis.hSet(QUEUE_KEY, rest);
          await redis.del(PENDING_DELETE_KEY);
          raw = await redis.hGetAll(QUEUE_KEY);
        }
        const answer = (typeof raw['answer'] === 'string' ? raw['answer'] : null) ?? '';
        const celebrityName = (typeof raw['celebrityName'] === 'string' ? raw['celebrityName'] : null) ?? '';
        const levelEntries = Object.entries(raw).filter(
          ([key]) =>
            !META_KEYS.includes(key) &&
            !key.endsWith('_originalLink') &&
            !key.endsWith('_license')
        );
        const options = levelEntries.map(([levelName, imageUrl]) => ({
          value: levelName,
          label: `${levelName}${celebrityName ? ` — ${celebrityName}` : ''}`,
        }));
        if (options.length === 0) {
          res.json({
            showForm: {
              name: 'deleteLevelForm',
              form: {
                fields: [
                  {
                    type: 'string',
                    name: 'levelName',
                    label: 'Level to delete',
                    helpText: 'No levels in the queue. Add levels with "Add level" first.',
                  },
                ],
              },
            },
          });
          return;
        }
        res.json({
          showForm: {
            name: 'deleteLevelForm',
            form: {
              fields: [
                {
                  type: 'select',
                  name: 'levelName',
                  label: 'Level to delete',
                  helpText: 'Select a level to remove from the queue, then submit.',
                  options,
                },
              ],
            },
          },
        });
      } catch (error) {
        logger.error('Error in manage-levels menu:', error);
        res.status(400).json({
          status: 'error',
          message: 'Manage levels failed',
        });
      } finally {
        logger.traceEnd();
      }
    }
  );

  router.post(
    '/internal/menu/post-level',
    async (_req, res): Promise<void> => {
      const logger = await Logger.Create('Menu - Post Level');
      logger.traceStart('Menu Action');
      try {
        const raw = await redis.hGetAll(QUEUE_KEY);
        const celebrityName =
          (typeof raw['celebrityName'] === 'string' ? raw['celebrityName'] : null) ?? '';
        const levelEntries = Object.entries(raw).filter(
          ([key]) =>
            !META_KEYS.includes(key) &&
            !key.endsWith('_originalLink') &&
            !key.endsWith('_license')
        );
        const options = levelEntries.map(([levelName]) => ({
          value: levelName,
          label: `${levelName}${celebrityName ? ` — ${celebrityName}` : ''}`,
        }));
        if (options.length === 0) {
          res.json({
            showForm: {
              name: 'createPostForm',
              form: {
                fields: [
                  {
                    type: 'string',
                    name: 'levelName',
                    label: 'Level to post',
                    helpText: 'No levels in the queue. Add levels with "Add level" first.',
                  },
                ],
              },
            },
          });
          return;
        }
        res.json({
          showForm: {
            name: 'createPostForm',
            form: {
              fields: [
                {
                  type: 'select',
                  name: 'levelName',
                  label: 'Level to post',
                  helpText: 'Select a level to create a new game post.',
                  options,
                },
              ],
            },
          },
        });
      } catch (error) {
        logger.error('Error in post-level menu:', error);
        res.status(400).json({
          status: 'error',
          message: 'Post level failed',
        });
      } finally {
        logger.traceEnd();
      }
    }
  );

  router.post(
    '/internal/menu/provide-data',
    async (_req, res): Promise<void> => {
      // Create a logger
      const logger = await Logger.Create('Menu - Provide Data');
      logger.traceStart('Menu Action');

      try {

        /* ========== Start Focus - Display a form to the user ========== */

        // See https://developers.reddit.com/docs/capabilities/client/forms
        // Show a form to enter a level name + game data for the level
        // NOTE: Currently, this will "overwrite" the level data for the given level name
        logger.info('Menu action triggered. Showing form to user.');
        res.json({
          showForm: {
            name: 'createGameForm',
            form: {
              fields: [
                {
                  type: 'string',
                  name: 'levelName',
                  label: 'Level Name',
                  helpText: 'Use a unique name (e.g. "Will Smith - Photo 1"). Duplicate names overwrite existing levels in the queue.',
                },
                // {
                //   type: 'string',
                //   name: 'gameData',
                //   label: 'Game Data',
                // },
                {
                  type: 'string',
                  name: 'imageUrl',
                  label: 'Image (Reddit URL or asset name)',
                  helpText: 'To use an image from Reddit: 1) Upload it (e.g. submit an image post to this subreddit), 2) Open the post, right‑click the image → "Copy image address", 3) Paste that URL here (must be i.redd.it, redditmedia.com, or redditstatic.com). Or use a filename from your app\'s assets folder (e.g. celebrity1.jpg) after adding the file to assets/ and running devvit upload.',
                },
                {
                  type: 'select',
                  name: 'answer',
                  label: 'Answer',
                  options: [
                    { value: 'Delulu', label: 'Delulu' },
                    { value: 'Celulu', label: 'Celulu' },
                  ],
                },
                {
                  type: 'string',
                  name: 'celebrityName',
                  label: 'Celebrity Name',
                  optional: true,
                },
                {
                  type: 'string',
                  name: 'originalImageLink',
                  label: 'Link to original image',
                  helpText: 'Optional URL to the original (unmodified) image for attribution.',
                  optional: true,
                },
                {
                  type: 'select',
                  name: 'imageLicense',
                  label: 'Image License',
                  options: [
                    { value: 'No restrictions', label: 'No restrictions' },
                    { value: 'CC2.0', label: 'CC 2.0' },
                  ],
                },
              ]
            }
          }
        });

        /* ========== End Focus - Display a form to the user ========== */

      } catch (error) {
        logger.error('Error in menu action:', error);
        res.status(400).json({
          status: 'error',
          message: 'Menu action failed'
        });
      } finally {
        logger.traceEnd();
      }
    });
}