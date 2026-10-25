import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

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

  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));

  // Banking Security & Hardening Headers across all routes
  app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Sliding window in-memory rate limiter for /api
  const ipRequests = new Map<string, { count: number; resetAt: number }>();
  app.use('/api', (req, res, next) => {
    const ip = (req.ip || req.socket.remoteAddress || 'unknown') as string;
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxReqs = 180;

    const current = ipRequests.get(ip);
    if (!current || now > current.resetAt) {
      ipRequests.set(ip, { count: 1, resetAt: now + windowMs });
    } else {
      current.count += 1;
      if (current.count > maxReqs) {
        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please wait 1 minute before retrying.',
        });
        return;
      }
    }
    next();
  });

  // Security & CORS headers on /api/*
  app.use('/api', (req, res, next) => {
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
    });
  });

  // 2. Get Webhook Event Logs
  app.get('/api/v1/webhooks/logs', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      events: webhookLogs,
    });
  });

  // 3. Real-Time Server-Sent Events (SSE) Stream
  app.get('/api/v1/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Send initial state snapshot so reconnecting clients reconcile missed events
    res.write(
      `event: init\ndata: ${JSON.stringify({
        connectedClients: sseClients.size + 1,
        events: webhookLogs.slice(0, 30),
      })}\n\n`
    );

    sseClients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // 4. Mobile Installer Webhook Endpoint (POST /api/v1/installations/sync)
  app.post('/api/v1/installations/sync', (req: Request, res: Response) => {
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
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
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
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[POS & Sound Box CRM Server] Running on http://0.0.0.0:${PORT} (SSE + Mobile System Webhook API Active)`
    );
  });
}

startServer();

