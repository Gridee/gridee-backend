import express from 'express';
import * as dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { db } from './db';
import { redis } from './redis';
import { ethers } from 'ethers';
import botRoutes from './routes/botRoutes';
import halRoutes from './routes/halRoutes';
import whatsappRoutes from './routes/whatsappRoutes';
import webhookRoutes from './routes/webhookRoutes';
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
const PORT = parseInt(process.env.PORT || '8000', 10);
const IS_DEV_MODE = String(process.env.IS_DEV || '').trim().toLowerCase() === 'true';

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-bot-secret', 'x-internal-secret'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));
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

app.use('/hal', generalLimiter, halRoutes);
app.use('/bot', generalLimiter, botRoutes);
app.use('/whatsapp', generalLimiter, whatsappRoutes);
// app.use('/webhooks', generalLimiter, webhookRoutes);

app.get('/dev/meter-sim', (_req, res) => {
  if (!IS_DEV_MODE) {
    res.status(403).send('Only available when IS_DEV=true');
    return;
  }

  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Meter Simulator</title>
<style>
body{font-family:Arial,sans-serif;margin:24px;background:#f6f7fb}
.card{max-width:760px;background:#fff;padding:20px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
.row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
input,button{padding:10px;border:1px solid #ccc;border-radius:8px}
button{background:#111;color:#fff;cursor:pointer}
pre{background:#111;color:#00ff7f;padding:12px;border-radius:8px}
</style></head>
<body><div class="card"><h2>Gridee Meter Simulator</h2><p>Dev-only helper for live demos.</p>
<div class="row"><input id="tenantId" type="number" placeholder="Tenant ID"/><input id="kwh" type="number" step="0.1" value="0.5" placeholder="kWh"/></div>
<div class="row"><button onclick="consume()">Simulate Consumption</button><button onclick="consumeFast()">Simulate 2 kWh</button><button onclick="cutoff()">Force Cut-off</button><button onclick="recon()">Force Reconnect</button></div>
<pre id="out">Ready.</pre></div>
<script>
const out=document.getElementById('out');
const tenantId=()=>Number(document.getElementById('tenantId').value);
const kwh=()=>Number(document.getElementById('kwh').value||0.5);
async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});out.textContent=JSON.stringify(await r.json(),null,2);}
function consume(){post('/api/hal/mock-consume',{tenantId:tenantId(),kwhAmount:kwh()});}
function consumeFast(){post('/api/hal/mock-consume',{tenantId:tenantId(),kwhAmount:2});}
function cutoff(){post('/api/hal/cutoff',{tenantId:tenantId()});}
function recon(){post('/api/hal/reconnect',{tenantId:tenantId()});}
</script></body></html>`);
});

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
