import { Request, Response, NextFunction } from 'express';

export const requireBotSecret = (req: Request, res: Response, next: NextFunction): void => {
  const secret = req.headers['x-bot-secret'] as string;
  const expected = process.env.BOT_SHARED_SECRET;

  if (!expected) {
    res.status(500).json({ error: 'Bot secret not configured' });
    return;
  }

  if (!secret || secret !== expected) {
    res.status(401).json({ error: 'Unauthorized: Invalid bot secret' });
    return;
  }

  next();
};
