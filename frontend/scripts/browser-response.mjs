export async function captureJsonResponse(page, predicate, action) {
  // Start reading on the response event, not after the action settles: an
  // action can finish after navigation has invalidated Chromium's body handle.
  const body = page.waitForResponse(predicate).then(response => response.json());
  const [data] = await Promise.all([body, Promise.resolve().then(action)]);
  return data;
}
