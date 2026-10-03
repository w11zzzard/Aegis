import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from './api';

afterEach(() => vi.useRealTimers());

describe('independent native response lifecycle review', () => {
  it('sanitizes a native read failure after partial content and releases its reader', async () => {
    vi.useFakeTimers();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (++pulls === 1) controller.enqueue(new TextEncoder().encode('synthetic private response'));
        else controller.error(new Error('synthetic private transport detail'));
      },
    }, { highWaterMark: 0 });
    let signal!: AbortSignal;
    let added!: ReturnType<typeof vi.spyOn>;
    let removed!: ReturnType<typeof vi.spyOn>;
    const promise = createApi('', async (_url, options) => {
      signal = options.signal as AbortSignal;
      added = vi.spyOn(signal, 'addEventListener');
      removed = vi.spyOn(signal, 'removeEventListener');
      return new Response(stream);
    }).events();
    await expect(promise).rejects.toThrow('Backend unreachable: /api/events. Response interrupted or timed out; retry.');
    expect(pulls).toBe(2);
    expect(signal.aborted).toBe(true);
    expect(stream.locked).toBe(false);
    expect(removed.mock.calls.filter((call: unknown[]) => call[0] === 'abort')).toHaveLength(added.mock.calls.filter((call: unknown[]) => call[0] === 'abort').length);
    expect(vi.getTimerCount()).toBe(0);
    await Promise.resolve();
  });

  it('releases a native pending read if reader cancellation itself throws synchronously', async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>();
    const original = ReadableStreamDefaultReader.prototype.cancel;
    const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel').mockImplementation(function () {
      throw new Error('synthetic private cancellation detail');
    });
    try {
      const promise = createApi('', async () => new Response(stream)).events();
      const assertion = expect(promise).rejects.toThrow(/response interrupted or timed out/i);
      await vi.advanceTimersByTimeAsync(10000);
      await assertion;
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(stream.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      await Promise.resolve();
    } finally {
      cancel.mockRestore();
      // Stop the synthetic source after proving lock release. The original
      // cleanup primitive is restored before this independent teardown.
      expect(ReadableStreamDefaultReader.prototype.cancel).toBe(original);
      await stream.cancel();
    }
  });

});
