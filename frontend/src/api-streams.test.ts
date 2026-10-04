import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from './api';
import { ContractError } from './adapter';

afterEach(() => vi.useRealTimers());

describe('response stream lifecycle', () => {
  it.each([
    ['finite', undefined], ['oversized', '524289'], ['endless', '1'], ['stalled', undefined],
  ])('aborts and cancels unread %s HTTP errors without reading private content', async (_mode, length) => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const pull = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    const getReader = vi.spyOn(stream, 'getReader');
    let signal!: AbortSignal;
    const api = createApi('', async (_url, options) => {
      signal = options.signal as AbortSignal;
      return new Response(stream, { status: 503, headers: length ? { 'Content-Length': length } : {} });
    });
    await expect(api.events()).rejects.toThrow('Backend request failed: /api/events (HTTP 503).');
    expect(signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(getReader).not.toHaveBeenCalled();
    expect(pull).not.toHaveBeenCalled();
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['rejects', 'stalls', 'throws'])('settles a sanitized HTTP error even when cancellation %s', async mode => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => mode === 'rejects' ? Promise.reject(new Error('synthetic private cleanup detail')) : new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({ cancel });
    if (mode === 'throws') vi.spyOn(stream, 'cancel').mockImplementation(() => { throw new Error('synthetic private cleanup detail'); });
    let signal!: AbortSignal;
    const promise = createApi('', async (_url, options) => {
      signal = options.signal as AbortSignal;
      return new Response(stream, { status: 401 });
    }).events();
    await expect(promise).rejects.toThrow('Backend request failed: /api/events (HTTP 401).');
    expect(signal.aborted).toBe(true);
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    // Give rejected cleanup promises a turn: Vitest also fails on unhandled rejections.
    await Promise.resolve();
  });

  it.each(['advertised', 'streamed'])('aborts %s oversized success and releases its body', async mode => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => Promise.reject(new Error('synthetic cleanup failure')));
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(524289)); }, cancel });
    let signal!: AbortSignal;
    await expect(createApi('', async (_url, options) => {
      signal = options.signal as AbortSignal;
      return new Response(stream, { headers: mode === 'advertised' ? { 'Content-Length': '524289' } : {} });
    }).events()).rejects.toBeInstanceOf(ContractError);
    expect(signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases timeout listeners and reader locks even when read/cancel never settle', async () => {
    vi.useFakeTimers();
    const reader = { read: vi.fn(() => new Promise(() => {})), cancel: vi.fn(() => new Promise(() => {})), releaseLock: vi.fn() };
    let signal!: AbortSignal;
    let remove!: ReturnType<typeof vi.spyOn>;
    const promise = createApi('', async (_url, options) => {
      signal = options.signal as AbortSignal;
      remove = vi.spyOn(signal, 'removeEventListener');
      return { ok: true, headers: new Headers(), body: { getReader: () => reader } } as unknown as Response;
    }).events();
    const assertion = expect(promise).rejects.toThrow(/response interrupted or timed out/i);
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    expect(signal.aborted).toBe(true);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['rejects', 'stalls'])('unlocks a real timed-out reader even when its cancellation %s', async mode => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => mode === 'rejects' ? Promise.reject(new Error('synthetic cleanup failure')) : new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const promise = createApi('', async () => new Response(stream)).events();
    const assertion = expect(promise).rejects.toThrow(/response interrupted or timed out/i);
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['invalid JSON', 'invalid UTF-8', 'invalid contract'])('releases consumed %s responses with safe errors', async mode => {
    vi.useFakeTimers();
    const bytes = mode === 'invalid UTF-8' ? new Uint8Array([0xff]) : new TextEncoder().encode(mode === 'invalid JSON' ? 'private not-json' : '{"events":[{}]}');
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); }, cancel });
    await expect(createApi('', async () => new Response(stream)).events()).rejects.toBeInstanceOf(ContractError);
    expect(stream.locked).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts valid UTF-8 JSON at the exact byte budget despite a false smaller length', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const valid = new TextEncoder().encode('["\u00f3"]' + ' '.repeat(524288 - new TextEncoder().encode('["\u00f3"]').byteLength));
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(valid.slice(0, 3)); controller.enqueue(valid.slice(3)); controller.close(); }, cancel });
    let signal!: AbortSignal;
    const value = await createApi('', async (_url, options) => {
      signal = options.signal as AbortSignal;
      return new Response(stream, { headers: { 'Content-Length': '1' } });
    }).stats();
    expect(value).toEqual(['\u00f3']);
    expect(signal.aborted).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
