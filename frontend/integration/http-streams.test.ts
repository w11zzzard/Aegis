import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api';

// A bounded real HTTP peer. Every test gets its own loopback server and watchdog.
// Observe the socket, rather than treating a rejected client promise as evidence
// that the unread upstream transfer stopped.
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });

function bounded<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), milliseconds);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

async function fixture(mode: string) {
  let bytesSent = 0;
  let finished = false;
  let socketDisconnected = false;
  let closed!: () => void;
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  const sockets = new Set<import('node:net').Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = http.createServer((request, response) => {
    request.socket.once('close', () => { socketDisconnected = true; closed(); });
    response.on('error', () => {});
    response.once('finish', () => { finished = true; });
    response.writeHead(503, { 'Content-Type': 'application/json', ...(mode === 'false-small' ? { 'Content-Length': '1' } : mode === 'false-large' ? { 'Content-Length': '16777216' } : {}) });
    response.flushHeaders();
    const chunk = Buffer.alloc(mode === 'oversized' ? 65536 : 4096, 'x');
    const write = () => {
      if (response.destroyed) return;
      bytesSent += chunk.length;
      response.write(chunk);
    };
    if (mode !== 'stalled') write();
    if (mode === 'oversized' || mode === 'endless' || mode.startsWith('false-')) {
      const interval = setInterval(write, 10);
      timers.add(interval);
      response.once('close', () => { clearInterval(interval); timers.delete(interval); });
    }
    // Finite body has a delayed tail; stalled/endless peers are stopped by the
    // watchdog. The client must disconnect well before this 1.5-second cap.
    const watchdog = setTimeout(() => {
      timers.delete(watchdog);
      if (mode === 'finite' || mode === 'oversized') response.end();
      else response.destroy();
    }, 1500);
    timers.add(watchdog);
    response.once('close', () => { clearTimeout(watchdog); timers.delete(watchdog); });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback listener missing');
  disposers.push(async () => {
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return { base: `http://127.0.0.1:${address.port}`, disconnected, get socketDisconnected() { return socketDisconnected; }, get bytesSent() { return bytesSent; }, get finished() { return finished; } };
}

describe('real HTTP error stream disconnection', () => {
  it.each(['finite', 'oversized', 'endless', 'stalled', 'false-small', 'false-large'])('disconnects %s 503 before the peer watchdog or byte budget', async mode => {
    const peer = await fixture(mode);
    let signal!: AbortSignal;
    const started = performance.now();
    const api = createApi(peer.base, (url, options) => { signal = options.signal as AbortSignal; return fetch(url, options); });
    try {
      await expect(bounded(api.events(), 750, 'HTTP error did not settle')).rejects.toThrow('HTTP 503');
      await bounded(peer.disconnected, 750, 'Unread HTTP connection remained active');
      expect(signal.aborted).toBe(true);
      expect(performance.now() - started).toBeLessThan(1000);
      expect(peer.bytesSent).toBeLessThan(524288);
      expect(peer.finished).toBe(false);
    } finally {
      console.info(JSON.stringify({ mode, status: 503, aborted: signal?.aborted, socketDisconnected: peer.socketDisconnected, bytesSent: peer.bytesSent, completeBodySent: peer.finished }));
    }
  });
});
