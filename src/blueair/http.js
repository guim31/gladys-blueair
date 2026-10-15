// -----------------------------------------------------------------------------
// The one function that talks to the network: an HTTPS request on the global
// fetch of Node, with a form or JSON body, a timeout and a size cap. The
// clients take it as a parameter: the tests replace it with an in-memory
// Blueair cloud (test/helpers/fakeBlueair.js).
// -----------------------------------------------------------------------------

const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {Record<string, string>} [options.headers]
 * @param {Record<string, string>} [options.form] body, sent as application/x-www-form-urlencoded
 * @param {unknown} [options.json] body, sent as JSON
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export async function httpRequest(
  url,
  { method = 'GET', headers = {}, form, json, timeoutMs = 15_000 } = {},
) {
  const requestHeaders = { accept: 'application/json, text/javascript, */*', ...headers };
  let body;
  if (form !== undefined) {
    body = new URLSearchParams(form).toString();
    requestHeaders['content-type'] = 'application/x-www-form-urlencoded';
  } else if (json !== undefined) {
    body = JSON.stringify(json);
    requestHeaders['content-type'] = 'application/json';
  }
  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BODY_BYTES) {
    throw new Error('Response too large');
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: buffer.toString('utf8'),
  };
}
