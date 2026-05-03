import express, { type Router, type RequestHandler } from 'express';
import { logger } from '../lib/logger';
import { PaymentWebhookHandler } from './PaymentWebhookHandler';

export interface PaymentWebhookRouteOptions {
  handler: PaymentWebhookHandler;
  /** Path the route mounts on. Default '/webhooks/flutterwave'. */
  path?: string;
  /** Header name carrying the provider signature. Default 'verif-hash' (Flutterwave). */
  signatureHeader?: string;
  /** Max raw body size. Default '1mb'. */
  bodyLimit?: string;
}

/**
 * Build an Express Router for the payment webhook endpoint.
 *
 * MOUNTING:
 *   const app = express();
 *   app.use(makePaymentWebhookRouter({ handler }));
 *
 * IMPORTANT — DO NOT mount express.json() globally before this router. The
 * webhook needs raw bytes for signature verification. We mount express.raw()
 * route-locally below so other routes (admin, healthcheck) can still parse
 * JSON normally.
 */
export function makePaymentWebhookRouter(opts: PaymentWebhookRouteOptions): Router {
  const router = express.Router();
  const path = opts.path ?? '/webhooks/flutterwave';
  const signatureHeader = (opts.signatureHeader ?? 'verif-hash').toLowerCase();
  const bodyLimit = opts.bodyLimit ?? '1mb';

  const handler: RequestHandler = async (req, res) => {
    // express.raw() leaves req.body as a Buffer.
    const rawBody: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : '');

    const signature = req.headers[signatureHeader];
    const sigStr = typeof signature === 'string' ? signature : Array.isArray(signature) ? signature[0] : undefined;

    let outcome;
    try {
      outcome = await opts.handler.handle(rawBody, sigStr);
    } catch (err) {
      // The handler is supposed to never throw — defensive.
      logger.error(
        { err: (err as Error).message, stack: (err as Error).stack },
        'PaymentWebhookHandler.handle threw unexpectedly',
      );
      res.status(500).end();
      return;
    }

    const status = PaymentWebhookHandler.httpStatusFor(outcome);
    res.status(status).json({ received: true, kind: outcome.kind });
  };

  router.post(path, express.raw({ type: '*/*', limit: bodyLimit }), handler);
  return router;
}
