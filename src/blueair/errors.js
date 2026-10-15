// -----------------------------------------------------------------------------
// Errors of the Blueair clients, one `kind` per remedy: the hub logs them, the
// connection status explains them to the user (src/texts.js), and only some of
// them are worth retrying.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  // E-mail or password refused: retrying would only lock the account.
  AUTH: 'auth',
  // Too many attempts, or the account is locked on the Blueair side.
  LOCKED: 'locked',
  // The account must be completed in the Blueair app (no name to finish the registration with).
  REGISTRATION: 'registration',
  // The cloud does not answer (network, timeout, 5xx).
  UNREACHABLE: 'unreachable',
  // HTTP 429: slow down.
  RATE_LIMIT: 'rate_limit',
  // The access token expired or was refused: log in again, then retry once.
  SESSION: 'session',
  // Anything else unexpected (a malformed answer...).
  HTTP: 'http',
});

export class BlueairError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message never a credential, a token or an address with credentials
   */
  constructor(kind, message) {
    super(message);
    this.name = 'BlueairError';
    this.kind = kind;
  }
}

/** A network failure (DNS, refused connection, timeout) as a BlueairError. */
export function networkError(err, what) {
  const reason = err?.name === 'TimeoutError' ? 'timed out' : (err?.cause?.code ?? err?.message);
  return new BlueairError(ERROR_KINDS.UNREACHABLE, `${what}: ${reason}`);
}

/** The BlueairError of an HTTP status that is not a success. */
export function statusError(status, what) {
  if (status === 429) {
    return new BlueairError(ERROR_KINDS.RATE_LIMIT, `${what}: too many requests (HTTP 429)`);
  }
  if (status >= 500) {
    return new BlueairError(ERROR_KINDS.UNREACHABLE, `${what}: HTTP ${status}`);
  }
  if (status === 401 || status === 403) {
    return new BlueairError(ERROR_KINDS.SESSION, `${what}: HTTP ${status}`);
  }
  return new BlueairError(ERROR_KINDS.HTTP, `${what}: HTTP ${status}`);
}

/** Parse a JSON body, or throw an HTTP-kind error naming what was read. */
export function parseJson(body, what) {
  try {
    return JSON.parse(body);
  } catch {
    throw new BlueairError(ERROR_KINDS.HTTP, `${what}: the answer is not JSON`);
  }
}
