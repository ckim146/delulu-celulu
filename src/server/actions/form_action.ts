/*
 * Registers an action when the form in the menu action is submitted. This form endpoint is defined in the devvit.json.
 * See https://developers.reddit.com/docs/capabilities/client/forms
 *
 * u/beach-brews
 */

import { Router } from 'express';
import { context, reddit, redis } from '@devvit/web/server';
import { Logger } from '../utils/Logger';

const QUEUE_KEY = 'data:queue';

export const formAction = (router: Router): void => {
  // Probe: minimal handler to debug status 36. In devvit.json temporarily set:
  // "deleteLevelForm": "/internal/form/delete-level-probe"
  // If probe works, the error is in the main handler; if not, it's form config or Devvit.
  router.post('/internal/form/delete-level-probe', (_req, res) => {
    res.status(200).json({
      showToast: { appearance: 'success', text: 'Probe OK' },
    });
  });

  router.post('/internal/form/delete-level', async (req, res) => {
    const logger = await Logger.Create('Form - Delete Level');
    logger.traceStart('Form Action');
  
    try {
      const body = req.body ?? {};
      const rawLevelName = body.levelName ?? body.form?.levelName;
      const keyToRemove =
        typeof rawLevelName === 'string'
          ? rawLevelName.trim()
          : Array.isArray(rawLevelName) && rawLevelName[0] != null
            ? String(rawLevelName[0]).trim()
            : '';

      if (keyToRemove) {
        const fieldsToRemove = [
          keyToRemove,
          `${keyToRemove}_originalLink`,
          `${keyToRemove}_license`,
        ];
        await redis.hDel(QUEUE_KEY, fieldsToRemove);
      }
      res.status(200).json({
        showToast: { text: 'Level removed from the queue.' },
      });
  
    } catch (error) {
      logger.error('Error in delete-level form:', error);
      res.status(200).json({
        showToast: { text: 'Delete failed. Try again.' },
      });
    } finally {
      logger.traceEnd();
    }
  });
  

  // create-post: server runs inside devvit playtest — run "devvit logs" to see console.log
  router.post('/internal/form/create-post', (req, res) => {
    console.log('[create-post] handler hit');
    try {
      const body = req.body ?? {};
      const levelName =
        body.levelName;
      console.log('[create-post] levelName', levelName);
      if (!levelName) {
        res.status(200).json({
          showToast: { text: 'Please select a level to post.' },
        });
        return;
      }
      res.status(200).json({
        showToast: { text: 'Creating game post…' },
      });
      void (async () => {
        try {
          const raw = await redis.hGetAll(QUEUE_KEY);
          const imageUrl = raw[levelName];
          const gameData =
            typeof imageUrl === 'string' ? imageUrl : typeof imageUrl === 'number' ? String(imageUrl) : null;
          if (!gameData) return;
          const answer = raw['answer'];
          const celebrityName = raw['celebrityName'];
          const originalImageLink = raw[`${levelName}_originalLink`];
          const imageLicense = raw[`${levelName}_license`];
          const answerStr = typeof answer === 'string' ? answer : answer != null ? String(answer) : '';
          const celebrityNameStr = typeof celebrityName === 'string' ? celebrityName : celebrityName != null ? String(celebrityName) : '';
          const originalLinkStr = typeof originalImageLink === 'string' ? originalImageLink : '';
          const licenseStr = typeof imageLicense === 'string' ? imageLicense : 'No restrictions';
          const levelKey = `level:${levelName}`;
          await redis.del(levelKey);
          await redis.hSet(levelKey, {
            imageUrl: gameData,
            answer: answerStr,
            celebrityName: celebrityNameStr,
            ...(originalLinkStr && { originalImageLink: originalLinkStr }),
            imageLicense: licenseStr,
          });
          const subredditName = context.subredditName;
          if (!subredditName) return;
          const postData: Record<string, string> = {
            levelName,
            levelData: gameData,
            answer: answerStr,
            celebrityName: celebrityNameStr,
            imageLicense: licenseStr,
          };
          if (originalLinkStr) postData.originalImageLink = originalLinkStr;
          await reddit.submitCustomPost({
            subredditName,
            title: 'New Game Level - ' + levelName,
            splash: {
              appDisplayName: 'Level ' + levelName,
              heading: 'Level ' + levelName,
              description: 'Did you test to see if you are Delulu today?',
              backgroundUri: 'default-splash.png',
              buttonLabel: 'Tap to Start',
              appIconUri: 'default-icon.png',
            },
            postData,
          });
        } catch (err) {
          console.log('Create post failed: ', err);
          const logger = await Logger.Create('Form - Create Post');
          logger.error('Create post failed:', err);
        }
      })();
    } catch {
      res.status(200).json({
        showToast: { text: 'Something went wrong.' },
      });
    }
  });

  router.post(
    '/internal/form/create-game-form',
    async (req, res): Promise<void> => {
      // Create a logger
      const logger = await Logger.Create('Form - Create Game');
      logger.traceStart('Form Action');

      try {

        /* ========== Start Focus - Queue level data ========== */

        // Level data can be provided many different ways, along with different methods of creating new posts
        // (manually vs. periodically). As an example, this action adds the provided data to a queue for processing by
        // a scheduled action. Be sure to check out the notes in 3_scheduledAction.ts!

        // Obtain level data from form (normalize to strings; form may send arrays for select fields)
        const { levelName, imageUrl, answer, celebrityName, originalImageLink, imageLicense } = req.body;
        const str = (v: unknown): string =>
          Array.isArray(v) ? (v[0] != null ? String(v[0]) : '') : v != null ? String(v) : '';
        const levelNameStr = str(levelName).trim();
        const imageUrlStr = str(imageUrl).trim();
        logger.info(`Form action triggered. Saving ${levelNameStr} and ${imageUrlStr} to processing queue.`);

        const originalLinkStr = typeof originalImageLink === 'string' ? originalImageLink.trim() : str(originalImageLink).trim();
        const licenseStr = str(imageLicense) || 'No restrictions';
        const toSet: Record<string, string> = {
          [levelNameStr]: imageUrlStr,
          answer: str(answer),
          celebrityName: str(celebrityName),
          [`${levelNameStr}_license`]: licenseStr,
        };
        if (originalLinkStr) toSet[`${levelNameStr}_originalLink`] = originalLinkStr;
        await redis.hSet(QUEUE_KEY, toSet);

        // Display success to user
        res.status(200).json({
          showToast: {
            appearance: 'success',
            text: 'Successfully queued game data'
          }
        });

        /* ========== End Focus - Queue level data ========== */

      } catch (error) {
        logger.error('Error in form action:', error);
        res.status(400).json({
          status: 'error',
          message: 'Form action failed'
        });
      } finally {
        logger.traceEnd();
      }
    }
  );
}