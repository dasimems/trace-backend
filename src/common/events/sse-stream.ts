import type { FastifyReply } from 'fastify';
import type { CustomRequest } from '@common/authentication/authentication.dto';

// Cached lazily so we don't re-parse CORS_ORIGINS on every connection.
let cachedOrigins: Set<string> | null = null;
function getAllowedOrigins(): Set<string> {
  if (cachedOrigins) return cachedOrigins;
  cachedOrigins = new Set(
    (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return cachedOrigins;
}

// Opens a long-lived SSE response. The reason this exists as a helper instead
// of just calling res.raw.writeHead() inline:
//
// 1. Writing to res.raw bypasses Fastify's reply lifecycle, which means the
//    CORS headers staged by @fastify/cors (NestJS enableCors) via
//    reply.header() never reach the wire. Browsers then block the EventSource
//    silently. We must echo Access-Control-Allow-Origin ourselves.
// 2. The HTTP server has a 10s idle timeout (main.ts) but our SSE heartbeat
//    is 15s — the socket would be killed before the first heartbeat fires.
//    setTimeout(0) disables the idle timeout for this socket only.
// 3. res.hijack() tells Fastify we own the response so it doesn't try to send
//    its own body after the route handler returns.
export function openSseStream(req: CustomRequest, res: FastifyReply) {
  const origin = req.headers.origin;
  const corsHeaders: Record<string, string> = {};
  if (typeof origin === 'string' && getAllowedOrigins().has(origin)) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
    corsHeaders['Access-Control-Allow-Credentials'] = 'true';
    corsHeaders['Vary'] = 'Origin';
  }

  res.hijack();
  req.raw.socket?.setTimeout(0);

  const raw = res.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...corsHeaders,
  });
  raw.write(`: connected ${new Date().toISOString()}\n\n`);

  return raw;
}
