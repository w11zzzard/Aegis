import { expect } from '@playwright/test';

export function observeApiRequests(page) {
  const pending = new Map();
  const started = request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/')) pending.set(request, pathname);
  };
  const ended = request => pending.delete(request);
  page.on('request', started);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  return {
    // Observe complete transfers, not headers or a latched document lifecycle
    // event. Failed requests are drained here but remain fatal in the verifier.
    pendingPaths: () => [...pending.values()],
    waitForIdle: (timeout = 10000) => expect.poll(() => [...pending.values()], {
      timeout, message: 'Current API transfers must end before session changes or navigation',
    }).toEqual([]),
    dispose() {
      page.off('request', started);
      page.off('requestfinished', ended);
      page.off('requestfailed', ended);
      pending.clear();
    },
  };
}
