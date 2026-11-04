import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { timingSafeEqual } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerWebhookEvent {
  eventId: string;
  timestamp: string;
  serial: string;
  previousStage?: string;
  newStage: string;
  mid: string;
  tid: string;
  merchantName: string;
  merchantPhone: string;
  address: string;
  installerStaff: string;
  branchId: string;
  note: string;
  source: 'MOBILE_APP_WEBHOOK' | 'COMPANION_SIMULATOR';
  status: 'APPLIED' | 'QUEUED';
}

const VALID_STAGES = new Set([
  'HQ_STOCK',
  'BRANCH_RESERVE',
  'CONFIGURING',
  'OUT_FOR_INSTALL',
  'COMPLETE',
  'FAULTY',
  'LOST',
]);

// Authoritative Server-Side Webhook Log & Connected SSE Clients
const webhookLogs: ServerWebhookEvent[] = [];

const sseClients = new Set<Response>();
// (03 Nov 2026, audit) cap on open live-stream connections: each one holds a socket and a timer
const MAX_SSE_CLIENTS = Number(process.env.MAX_SSE_CLIENTS) || 200;

// (03 Nov 2026, audit) X-Installer-Key was listed in the CORS headers but never checked, so anyone could post fake
// installations and read the merchant names/phones in the log. When INSTALLER_API_KEY is set, the sync, log and stream
// endpoints require it (header X-Installer-Key, or ?key= for the browser stream, which cannot send headers).
// In production without a key the endpoints are closed (fail closed); local development without a key stays open.
const INSTALLER_API_KEY = (process.env.INSTALLER_API_KEY || '').trim();

function keyMatches(given: unknown): boolean {
  if (!INSTALLER_API_KEY || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(INSTALLER_API_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

function broadcastSseEvent(eventName: string, data: unknown) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function formatNowTimestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

function sanitizeField(input: unknown, maxLen = 160): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  // (03 Nov 2026, audit) Reverse-proxy trust is now opt-in. With a fixed 'trust proxy = 1' and no proxy in front, any
  // client could send its own X-Forwarded-For header, appear as a new IP on every request and bypass the rate limit
  // (load test: 5,100/5,100 spoofed requests accepted). Set TRUST_PROXY=1 (number of hops) only behind a real proxy.
  const trustProxy = process.env.TRUST_PROXY;
  app.set('trust proxy', trustProxy ? (Number.isFinite(Number(trustProxy)) ? Number(trustProxy) : trustProxy) : false);
  if (isProd && !INSTALLER_API_KEY) {
    console.warn('[Security] INSTALLER_API_KEY is not set: the installer sync, log and stream endpoints are closed.');
  }

  const requireInstallerKey = (req: Request, res: Response, next: NextFunction) => {
    if (!INSTALLER_API_KEY) {
      if (!isProd) return next();
      res.status(503).json({ ok: false, error: 'Installer API is not configured on this server.' });
      return;
    }
    const given = req.get('x-installer-key') ?? (typeof req.query.key === 'string' ? req.query.key : undefined);
    if (!keyMatches(given)) {
      res.status(401).json({ ok: false, error: 'Unauthorized', message: 'A valid X-Installer-Key is required.' });
      return;
    }
    next();
  };

  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));

  // Banking Security & Hardening Headers across all routes
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
  });

  // Sliding window in-memory rate limiter for /api with automatic memory leak pruning
  const ipRequests = new Map<string, { count: number; resetAt: number }>();
  const MAX_RATE_LIMIT_ENTRIES = 5000;

  // Prune expired rate limit entries every 2 minutes
  const rateLimitPruner = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of ipRequests.entries()) {
      if (now > entry.resetAt) {
        ipRequests.delete(ip);
      }
    }
  }, 2 * 60 * 1000);
  rateLimitPruner.unref?.();

  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.ip || req.socket.remoteAddress || 'unknown') as string;
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxReqs = 180;

    // Safety guard against memory growth. (03 Nov 2026, audit) Before, the whole table was cleared, which reset every
    // client's counter (including an abusive one). Now expired entries go first, then the oldest 10%.
    if (ipRequests.size > MAX_RATE_LIMIT_ENTRIES) {
      for (const [key, entry] of ipRequests) if (now > entry.resetAt) ipRequests.delete(key);
      if (ipRequests.size > MAX_RATE_LIMIT_ENTRIES) {
        let drop = Math.ceil(MAX_RATE_LIMIT_ENTRIES / 10);
        for (const key of ipRequests.keys()) { if (drop-- <= 0) break; ipRequests.delete(key); }
      }
    }

    const current = ipRequests.get(ip);
    if (!current || now > current.resetAt) {
      ipRequests.set(ip, { count: 1, resetAt: now + windowMs });
    } else {
      current.count += 1;
      if (current.count > maxReqs) {
        res.status(429).json({
          ok: false,
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please wait 1 minute before retrying.',
        });
        return;
      }
    }
    next();
  });

  // Security & CORS headers on /api/*
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Installer-Key');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // 1. Health & Sync Engine Status
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'POS & Sound Box Merchant Support Sync API',
      connectedClients: sseClients.size,
      totalWebhookEvents: webhookLogs.length,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  // 2. Get Webhook Event Logs
  app.get('/api/v1/webhooks/logs', requireInstallerKey, (_req: Request, res: Response) => {
    res.json({
      ok: true,
      events: webhookLogs,
    });
  });

  // 3. Real-Time Server-Sent Events (SSE) Stream
  app.get('/api/v1/stream', requireInstallerKey, (req: Request, res: Response) => {
    if (sseClients.size >= MAX_SSE_CLIENTS) {
      res.status(503).json({ ok: false, error: 'Too many live connections. Please retry shortly.' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering on Nginx / proxies
    res.flushHeaders?.();

    // Send initial state snapshot so reconnecting clients reconcile missed events
    res.write(
      `event: init\ndata: ${JSON.stringify({
        connectedClients: sseClients.size + 1,
        events: webhookLogs.slice(0, 30),
      })}\n\n`
    );

    sseClients.add(res);

    const cleanup = () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    };

    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        cleanup();
      }
    }, 25000);

    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('error', cleanup);
  });

  // 4. Mobile Installer Webhook Endpoint (POST /api/v1/installations/sync)
  app.post('/api/v1/installations/sync', requireInstallerKey, (req: Request, res: Response) => {
    const body = req.body || {};
    const serial = sanitizeField(body.serial, 40);
    const rawStage = sanitizeField(body.stage || 'COMPLETE', 30).toUpperCase();
    const newStage = VALID_STAGES.has(rawStage) ? rawStage : 'COMPLETE';

    if (!serial) {
      res.status(400).json({
        ok: false,
        error: 'Missing required field: serial',
      });
      return;
    }

    const eventId =
      sanitizeField(body.eventId, 60) ||
      `WHK-2026-${Math.floor(1000 + Math.random() * 8999)}-${Date.now().toString().slice(-3)}`;

    // Idempotency check
    const existing = webhookLogs.find((e) => e.eventId === eventId);
    if (existing) {
      res.json({
        ok: true,
        duplicate: true,
        event: existing,
      });
      return;
    }

    const newEvent: ServerWebhookEvent = {
      eventId,
      timestamp: formatNowTimestamp(),
      serial,
      previousStage: body.previousStage ? sanitizeField(body.previousStage, 30) : undefined,
      newStage,
      mid: sanitizeField(body.mid, 32),
      tid: sanitizeField(body.tid, 32),
      merchantName: sanitizeField(body.merchantName, 100),
      merchantPhone: sanitizeField(body.merchantPhone, 32),
      address: sanitizeField(body.address, 160),
      installerStaff: sanitizeField(body.installerStaff || 'Mobile Field Technician', 80),
      branchId: sanitizeField(body.branchId || '105', 10),
      note: sanitizeField(body.note || 'Updated via Mobile Field Installer App', 200),
      source:
        body.source === 'COMPANION_SIMULATOR' ? 'COMPANION_SIMULATOR' : 'MOBILE_APP_WEBHOOK',
      status: 'APPLIED',
    };

    webhookLogs.unshift(newEvent);
    if (webhookLogs.length > 100) {
      webhookLogs.length = 100;
    }

    // Broadcast to all connected CRM clients in real time
    broadcastSseEvent('installation:updated', newEvent);

    res.status(200).json({
      ok: true,
      message: `Serial ${serial} synced to stage ${newStage}`,
      event: newEvent,
    });
  });

  // Vite middleware in development, static dist in production
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, '..', 'dist');   // (the repository root's dist/)
    // 1-year immutable cache for hashed bundles in /assets/
    app.use('/assets', express.static(path.join(distPath, 'assets'), { maxAge: '1y', immutable: true }));
    // General static files with 1-day cache; index.html and sw.js must revalidate
    app.use(express.static(distPath, {
      maxAge: '1d',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        }
      }
    }));
    app.get('*', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Centralized Error Handling Middleware
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // (03 Nov 2026, audit) a malformed or oversized JSON body is the client's error (400 / 413), not a server crash (500)
    const status = (err as { status?: number; type?: string })?.status;
    if (status && status >= 400 && status < 500 && !res.headersSent) {
      const type = (err as { type?: string }).type;
      res.status(status).json({
        ok: false,
        error: type === 'entity.too.large' ? 'Payload Too Large' : 'Bad Request',
        message: type === 'entity.parse.failed' ? 'The request body is not valid JSON.' : 'The request could not be processed.',
      });
      return;
    }
    const errorMsg = err instanceof Error ? err.message : 'Internal Server Error';
    console.error('[API Server Error]:', err);
    if (!res.headersSent) {
      res.status(500).json({
        ok: false,
        error: 'Internal Server Error',
        message: isProd ? 'An unexpected server error occurred.' : errorMsg,
      });
    }
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[POS & Sound Box CRM Server] Running on http://0.0.0.0:${PORT} (SSE + Mobile System Webhook API Active)`
    );
  });

  // Graceful shutdown handlers for container/process managers
  const gracefulShutdown = (signal: string) => {
    console.log(`[Server] Received ${signal}. Starting graceful shutdown...`);
    clearInterval(rateLimitPruner);
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    sseClients.clear();
    server.close(() => {
      console.log('[Server] HTTP server closed gracefully.');
      process.exit(0);
    });
    // Force terminate if still alive after 10s
    setTimeout(() => {
      console.error('[Server] Forcefully terminating after timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer();
