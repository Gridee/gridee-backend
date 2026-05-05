import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../lib/logger';

type ParseFrom = 'body' | 'params';

interface BotHandlerOptions {
  status?: number;
  parseFrom?: ParseFrom;
}

type Handler<T> = (validated: T, req: Request) => Promise<Record<string, any> | void>;

export function withBotHandler<T extends z.ZodType>(
  schema: T | null,
  handler: Handler<T extends z.ZodType ? z.infer<T> : never>,
  options: BotHandlerOptions = {}
) {
  const { status = 200, parseFrom = 'body' } = options;

  return async (req: Request, res: Response): Promise<void> => {
    try {
      const source = parseFrom === 'params' ? req.params : req.body;
      const validated = schema ? schema.parse(source) : null;

      const result = await handler(validated as any, req);

      if (result) {
        res.status(status).json(result);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation failed', details: error.issues });
        return;
      }
      if (error instanceof Error) {
        const isClientError =
          error.message.includes('not found') ||
          error.message.includes('not found') ||
          error.message.includes('missing') ||
          error.message.includes('already registered') ||
          error.message.includes('required') ||
          error.message.includes('must be') ||
          error.message.includes('wasn\'t found');

        if (isClientError) {
          res.status(404).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
        logger.error({ err: error, route: req.path, method: req.method }, '[botHandler]');
      } else {
        res.status(500).json({ error: 'Internal server error' });
        logger.error({ err: error, route: req.path, method: req.method }, '[botHandler]');
      }
    }
  };
}
