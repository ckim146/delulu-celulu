/*
 * Registers an action when the form in the menu action is submitted. This form endpoint is defined in the devvit.json.
 * See https://developers.reddit.com/docs/capabilities/client/forms
 *
 * u/beach-brews
 */

import { Router } from 'express';
import { redis } from '@devvit/web/server';
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
      const levelName =
        typeof body.levelName === 'string'
          ? body.levelName
          : typeof body.form?.levelName === 'string'
            ? body.form.levelName
            : undefined;
  
      // if (!levelName?.trim()) {
      //   res.status(200).json({
      //     showToast: { text: 'Please select a level to delete.' },
      //   });
      //   return;
      // }
  
      const keyToRemove = body.levelName;
  
      // DO the Redis operation BEFORE responding
      console.log('Removing key:', body);
const result = await redis.hDel(QUEUE_KEY, keyToRemove);
console.log('Redis result:', result);
  
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

        // Obtain levelName and gameData from form
        const { levelName, imageUrl, answer, celebrityName } = req.body;
        logger.info(`Form action triggered. Saving ${levelName} and ${imageUrl} to processing queue.`);

        // Stores provided level data into Redis hash.
        await redis.hSet(QUEUE_KEY, { [levelName]: imageUrl, answer, celebrityName });

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