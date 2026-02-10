/*
 * Registers an action for a subreddit level menu. This menu is defined in the devvit.json.
 * See https://developers.reddit.com/docs/capabilities/client/menu-actions
 *
 * Allows a mod to submit a round: image, answer (Delulu/Celulu), and optional celebrity name.
 */

import { Router } from 'express';
import { Logger } from '../utils/logger';

export const menuAction = (router: Router): void => {
  router.post(
    '/internal/menu/provide-data',
    async (_req, res): Promise<void> => {
      const logger = await Logger.Create('Menu - Provide Data');
      logger.traceStart('Menu Action');

      try {
        logger.info('Menu action triggered. Showing form to moderator.');

        res.json({
          showForm: {
            name: 'createRoundForm',
            form: {
              fields: [
                {
                  type: 'string',
                  name: 'imageUrl',
                  label: 'Image URL',
                  helpText: 'Upload your image elsewhere (e.g. imgur), then paste the direct image URL here.',
                },
                {
                  type: 'select',
                  name: 'answer',
                  label: 'Answer',
                  helpText: 'Is this image Delulu (altered) or Celulu (real celebrity)?',
                  options: [
                    { value: 'Delulu', label: 'Delulu' },
                    { value: 'Celulu', label: 'Celulu' },
                  ],
                },
                {
                  type: 'string',
                  name: 'celebrityName',
                  label: 'Celebrity name (if Celulu)',
                  helpText: 'Only fill this in when the answer is Celulu.',
                },
              ],
            },
          },
        });
      } catch (error) {
        logger.error('Error in menu action:', error);
        res.status(400).json({
          status: 'error',
          message: 'Menu action failed',
        });
      } finally {
        logger.traceEnd();
      }
    }
  );
};