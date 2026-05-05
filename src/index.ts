import express from 'express';
import * as dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { db } from './db';
import { redis } from './redis';
import { ethers } from 'ethers';
import apiRouter from './routes';
import { startConsumptionEngine, stopConsumptionEngine } from './jobs/consumptionEngine';

dotenv.config();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }
    : undefined,
});

const requiredEnvVars = ['JWT_SECRET', 'DATABASE_URL'];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-bot-secret', 'verif-hash'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(pinoHttp({ logger }));

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again later' },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests, please try again later' },
});

app.use('/api', generalLimiter, apiRouter);

app.get('/health', async (req, res) => {
  const status: Record<string, string> = {};

  try {
    await db.raw('SELECT 1');
    status.db = 'ok';
  } catch {
    status.db = 'error';
  }

  try {
    const pong = await redis.ping();
    status.redis = pong === 'PONG' ? 'ok' : 'error';
  } catch {
    status.redis = 'error';
  }

  try {
    const provider = new ethers.JsonRpcProvider(process.env.CONTRACT_RPC_URL);
    await provider.getBlockNumber();
    status.rpc = 'ok';
  } catch {
    status.rpc = 'error';
  }

  const allOk = Object.values(status).every(v => v === 'ok');
  res.status(allOk ? 200 : 503).json(status);
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(err, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

let server: ReturnType<typeof app.listen> | undefined;

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down gracefully...`);
  stopConsumptionEngine();

  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed');
      await redis.quit();
      await db.destroy();
      logger.info('Connections closed');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  startConsumptionEngine();
  server = app.listen(PORT, () => {
    logger.info(`Server is running on http://localhost:${PORT}`);
  });
}

export { app, logger };
