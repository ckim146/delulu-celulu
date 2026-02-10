/*
 * Handles submission of the createRoundForm (image, answer, celebrity name).
 * Form endpoint is defined in devvit.json: "createRoundForm": "/internal/menu/round-submit"
 */

import { Router } from 'express';
import { redis } from '@devvit/web/server';
import { Logger } from '../utils/logger';

export const ROUNDS_HASH_KEY = 'delulu:rounds';

export const formAction = (router: Router): void => {
  router.post(
    '/internal/menu/round-submit',
    async (req, res): Promise<void> => {
      const logger = await Logger.Create('Form - Round Submit');
      logger.traceStart('Round Submit');

      try {
        const { imageUrl, answer, celebrityName } = req.body ?? {};

        if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
          res.status(400).json({
            status: 'error',
            message: 'Image URL is required',
          });
          return;
        }

        if (!answer || (answer !== 'Delulu' && answer !== 'Celulu')) {
          res.status(400).json({
            status: 'error',
            message: 'Answer must be Delulu or Celulu',
          });
          return;
        }

        const round = {
          imageUrl: imageUrl.trim(),
          answer,
          celebrityName: typeof celebrityName === 'string' ? celebrityName.trim() || undefined : undefined,
          used: false,
        };

        const roundId = Date.now().toString();
        const roundJson = JSON.stringify(round);
        await redis.hSet(ROUNDS_HASH_KEY, { [roundId]: roundJson });

        logger.info(`Round queued: answer=${answer}, celebrityName=${round.celebrityName ?? '(none)'}`);

        res.status(200).json({
          showToast: {
            appearance: 'success',
            text: 'Round saved successfully',
          },
        });
      } catch (error) {
        logger.error('Error in round submit:', error);
        res.status(400).json({
          status: 'error',
          message: 'Failed to save round',
        });
      } finally {
        logger.traceEnd();
      }
    }
  );
};
