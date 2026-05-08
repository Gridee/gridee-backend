import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

function getRequestIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]!.split(',')[0]!.trim();
  }
  return req.socket.remoteAddress || '';
}

function isPrivateIp(ip: string): boolean {
  if (!ip) return false;
  const normalized = ip.replace(/^::ffff:/, '');
  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
  );
}

function secureMatch(secret: string | undefined, expected: string): boolean {
  if (!secret) return false;
  const left = Buffer.from(secret);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const requireBotSecret = (req: Request, res: Response, next: NextFunction): void => {
  const secret = req.header('x-bot-secret') || req.header('x-internal-secret') || undefined;
  const expected = process.env.BOT_SHARED_SECRET;
  const allowPrivateNetwork = process.env.BOT_ALLOW_PRIVATE_NETWORK === 'true';

  if (!expected) {
    res.status(500).json({ error: 'Bot secret not configured' });
    return;
  }

  if (secureMatch(secret, expected)) {
    next();
    return;
  }

  const requestIp = getRequestIp(req);
  if (allowPrivateNetwork && isPrivateIp(requestIp)) {
    next();
    return;
  }

  if (!secret) {
    res.status(401).json({ error: 'Unauthorized: Missing bot secret' });
    return;
  }

  if (!secureMatch(secret, expected)) {
    res.status(401).json({ error: 'Unauthorized: Invalid bot secret' });
    return;
  }
};
