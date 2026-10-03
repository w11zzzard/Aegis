// Audit evidence only. These characterize current behavior, not repaired behavior.
import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../src/api';
import { ContractError, normalizeEvents } from '../src/adapter';

describe('isolated security audit evidence', () => {
  it('cross-origin API requests omit an explicit credentials mode', async () => {
    const transport = vi.fn(async (_url: string, _options: RequestInit) => new Response('[]'));
    await createApi('https://api.example.invalid', transport).events();
    expect(transport).toHaveBeenCalledWith('https://api.example.invalid/api/events',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }));
    expect(transport.mock.calls[0][1]).not.toHaveProperty('credentials');
    expect(new Request(transport.mock.calls[0][0], transport.mock.calls[0][1]).credentials).toBe('same-origin');
  });

  it('mislabels an abort while consuming the response body as a contract error', async () => {
    vi.useFakeTimers();
    try {
      const transport = vi.fn(async (_url: string, options: RequestInit) => ({
        ok: true,
        json: () => new Promise((_resolve, reject) => {
          options.signal!.addEventListener('abort', () => reject(
            new DOMException('Synthetic body aborted', 'AbortError')), { once: true });
        }),
      }) as Response);
      const response = createApi('', transport).events();
      const assertion = expect(response).rejects.toBeInstanceOf(ContractError);
      await vi.advanceTimersByTimeAsync(10000);
      await assertion;
    } finally { vi.useRealTimers(); }
  });

  it('also mislabels a body transport failure as a contract error', async () => {
    const transport = vi.fn(async () => ({ ok: true,
      json: async () => { throw new TypeError('Synthetic stream failure'); },
    }) as Response);
    await expect(createApi('', transport).events()).rejects.toBeInstanceOf(ContractError);
  });

  it('accepts 1000 audit rows and a 4096-character reason without bounds', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `synthetic-${i}`, reason: 'x'.repeat(4096) }));
    expect(normalizeEvents(rows)).toHaveLength(1000);
    expect(normalizeEvents(rows)[0].reason).toHaveLength(4096);
  });
});
