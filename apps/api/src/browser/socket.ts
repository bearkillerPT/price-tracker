// The live browser's WebSocket: frames out, input in. Handshakes skip Express, so they're checked here:
// same origin only (browsers send cookies on cross-site WebSocket handshakes too), then the login cookie.
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { LiveClientMessage } from '@price-tracker/shared';
import { validSessionCookie } from '../auth/sessions.ts';
import type { Db } from '../db/client.ts';
import type { LiveSessions } from './live.ts';

export const LIVE_SOCKET_PATH = '/api/browser/live';

const MESSAGE_TYPES = new Set(['viewport', 'mouse', 'wheel', 'key', 'text', 'nav', 'pick', 'pickParent']);

function refuse(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

const sameOrigin = (req: IncomingMessage): boolean => {
  try {
    return !!req.headers.origin && new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
};

export function attachLiveSocket(server: Server, db: Db, sessions: LiveSessions): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== LIVE_SOCKET_PATH) return refuse(socket, '404 Not Found');
      if (!sameOrigin(req)) return refuse(socket, '403 Forbidden');
      if (!(await validSessionCookie(db, req.headers.cookie))) return refuse(socket, '401 Unauthorized');
      const live = sessions.get(url.searchParams.get('id'));
      if (!live) return refuse(socket, '404 Not Found');

      wss.handleUpgrade(req, socket, head, (ws) => {
        const send = (message: unknown) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
          if ((message as { t?: string }).t === 'closed') ws.close();
        };
        live.attach(send);
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(String(data)) as LiveClientMessage;
            if (message && MESSAGE_TYPES.has(message.t)) live.input(message);
          } catch {
            // not JSON; ignore
          }
        });
        ws.on('close', () => live.detach(send));
      });
    })().catch(() => refuse(socket, '500 Internal Server Error'));
  });
}
