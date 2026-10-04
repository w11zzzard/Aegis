import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi, setSessionToken } from './api';
import { event } from './test-fixtures';

afterEach(() => setSessionToken(''));

describe('credential transport boundary', () => {
  it.each(['http://example.com', '//example.com', 'https://user:pass@example.com', 'https://example.com?token=x', 'https://example.com#fragment', '/\\example.com', 'file:///tmp/api'])('refuses unsafe API base %s before sending credentials', base => {
    expect(() => createApi(base)).toThrow(/API base/i);
  });
  it.each(['', '/gateway', 'https://api.example.com/gateway', 'http://127.0.0.1:8000', 'http://localhost:8000', 'http://[::1]:8000'])('allows TLS or explicit loopback/relative API base %s', base => {
    expect(() => createApi(base)).not.toThrow();
  });
  it('captures the credential exactly once for a request', async () => {
    const credential = vi.fn().mockReturnValueOnce('first').mockReturnValue('second');
    const transport = vi.fn(async (_url: string, _options: RequestInit) => new Response('{"events":[]}'));
    await createApi('', transport, credential).events();
    expect(credential).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1].headers).toHaveProperty('Authorization', 'Bearer first');
  });
  it('aborts old requests and refuses a late response even when the transport ignores abort', async () => {
    setSessionToken('old-synthetic-session');
    let release!: (response: Response) => void;
    let signal!: AbortSignal;
    const api = createApi('', async (_url, options) => {
      signal = options.signal as AbortSignal;
      return new Promise<Response>(resolve => { release = resolve; });
    });
    const pending = api.events();
    const refused = expect(pending).rejects.toThrow(/session changed/i);
    setSessionToken('new-synthetic-session');
    expect(signal.aborted).toBe(true);
    release(new Response(JSON.stringify([event])));
    await refused;
  });
  it('does not abort independent injected credential transports on dashboard disconnect', async () => {
    let signal!: AbortSignal;
    const api = createApi('', async (_url, options) => {
      signal = options.signal as AbortSignal;
      setSessionToken('');
      return new Response('{"events":[]}');
    }, () => 'independent-synthetic-session');
    await expect(api.events()).resolves.toEqual([]);
    expect(signal.aborted).toBe(false);
  });
  it('accepts only a consistent caller-scoped session response', async () => {
    const valid = { profile: 'authenticated', user: 'manager_1', role: 'PORTFOLIO_MANAGER', can_observe: false, can_admin: false };
    const api = createApi('', async () => new Response(JSON.stringify(valid)));
    await expect(api.session()).resolves.toEqual(valid);
    for (const invalid of [{ ...valid, can_admin: true }, { ...valid, can_observe: true }, { ...valid, user: null }, { ...valid, token: 'SYNTHETIC_PRIVATE' }]) {
      await expect(createApi('', async () => new Response(JSON.stringify(invalid))).session()).rejects.toThrow(/contract/i);
    }
  });
});
