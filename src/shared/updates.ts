/**
 * The update lifecycle, as the renderer sees it.
 *
 * Deliberately smaller than electron-updater's own event surface: the UI only
 * has to answer "is there anything to say to the user right now", and every
 * additional state is another thing to get wrong in a toast.
 */
export type UpdateStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  /** A check that found nothing. `manual` is what earns a "you're up to date". */
  | { phase: 'up-to-date'; checkedAt: string; manual: boolean }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; percent: number }
  /** Downloaded and staged. Applying it is the user's call, never ours. */
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string; manual: boolean }

/**
 * Whether this build can update itself at all. A dev run and an unpacked
 * build cannot, and telling someone an update is available when the app has
 * no way to install it is worse than saying nothing.
 */
export interface UpdateSupport {
  supported: boolean
  currentVersion: string
}

/**
 * The fields of an `electron-updater` failure worth classifying. `HttpError`
 * carries `statusCode` and a `HTTP_ERROR_<n>` code; the updater's own
 * failures carry an `ERR_UPDATER_*` code; a socket failure carries an errno
 * string. Everything is optional because the one thing always present is the
 * message, and the message is the least structured of the three.
 */
interface UpdateErrorLike {
  code?: unknown
  statusCode?: unknown
  message?: unknown
}

/**
 * The HTTP status, when there is one to be had. `HttpError` carries it as a
 * field, but the GitHub provider re-throws its own error with the original
 * stack folded into the message, and that wrapper is what reaches the UI —
 * so the status has to be read back out of the text as well, or every
 * wrapped failure classifies the same regardless of what went wrong.
 *
 * The three shapes are electron-updater's own: `404 Not Found` at the head of
 * an `HttpError` message, `HttpError: 404 Not Found` inside a wrapper, and
 * `status 404:` from a failed download.
 */
function statusFrom(code: string, message: string): number | null {
  const fromCode = /^HTTP_ERROR_(\d{3})$/.exec(code)
  if (fromCode) return Number(fromCode[1])
  const fromMessage = /(?:^|HttpError:\s*|status\s+)(\d{3})(?:[\s:]|$)/.exec(message)
  return fromMessage ? Number(fromMessage[1]) : null
}

function read(error: unknown): { code: string; status: number | null; message: string } {
  const like = (error ?? {}) as UpdateErrorLike
  const code = typeof like.code === 'string' ? like.code : ''
  const message = typeof like.message === 'string' ? like.message : String(error ?? '')
  return {
    code,
    status: typeof like.statusCode === 'number' ? like.statusCode : statusFrom(code, message),
    message
  }
}

/**
 * The errno and Chromium codes that all mean the same thing to a user: the
 * request never reached GitHub. Matched against the code and the message
 * both, since `getaddrinfo ENOTFOUND` arrives with the errno in the text and
 * nowhere else.
 */
const OFFLINE = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_NETWORK_CHANGED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_PROXY_CONNECTION_FAILED',
  'socket hang up',
  'network timeout'
]

/**
 * One short sentence for a failed update check, in place of whatever
 * `electron-updater` threw.
 *
 * This exists because of what the alternative looked like. A release whose
 * `latest-mac.yml` never uploaded put a raw `HttpError: 404` in front of
 * every user — status line, request URL, response headers, a note about
 * authentication tokens that had nothing to do with it, and a stack trace —
 * in a toast. None of it was theirs to read, and the one fact that mattered
 * ("that release is broken, not your machine") was not in there at all. The
 * detail belongs in the main-process log, which is where `UpdateService`
 * puts it.
 *
 * Deliberately classified rather than prettified: the outcomes below are the
 * ones a user can tell apart and, for two of them, do something about.
 * Anything else falls through to a plain sentence rather than being guessed
 * at, since a wrong explanation is worse than none.
 */
export function updateErrorMessage(error: unknown): string {
  const { code, status, message } = read(error)
  const haystack = `${code} ${message}`

  // Checked before the status, because a request that never left the machine
  // has no status, and because a proxy failure can carry one that describes
  // the proxy rather than GitHub.
  if (OFFLINE.some((needle) => haystack.includes(needle))) {
    return 'Arborist could not reach GitHub. Check your internet connection and try again.'
  }

  // A missing manifest, and the incident this function was written for: the
  // release exists, so the updater finds the version in the releases feed,
  // then 404s on the `latest*.yml` that should sit beside the installers.
  // `ERR_UPDATER_LATEST_VERSION_NOT_FOUND` is the GitHub provider wrapping
  // that same 404 with a stack trace, which is what actually reached the UI.
  // The codes are consulted only when no status could be read: the wrapper
  // puts the same `ERR_UPDATER_LATEST_VERSION_NOT_FOUND` on a 503 as on a
  // 404, so trusting the code over the status would tell a user their
  // release is broken every time GitHub had a bad minute.
  if (
    status === 404 ||
    (status === null &&
      (code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' ||
        code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'))
  ) {
    return 'This release is missing its update information, so Arborist cannot tell whether a newer version exists. Nothing is wrong with your copy.'
  }

  // GitHub's own fault, and transient often enough that "try later" is real
  // advice rather than a brush-off.
  if (status !== null && status >= 500 && status <= 599) {
    return 'GitHub could not serve the update information just now. Try again in a few minutes.'
  }

  // 403 and 429 are both rate limiting in practice — an unauthenticated
  // check from a busy address — and 401 reads the same way to someone who
  // has no token to fix.
  if (status === 401 || status === 403 || status === 429) {
    return 'GitHub turned the update check away, usually because of its rate limit. Try again in a few minutes.'
  }

  // A download that arrived and could not be trusted. Phrased around what
  // Arborist did about it, because "signature" and "checksum" are not the
  // user's problem — the fact that nothing was installed is.
  if (code === 'ERR_UPDATER_INVALID_SIGNATURE' || /signature|sha512|checksum/i.test(message)) {
    return 'The downloaded update could not be verified, so it was not installed.'
  }

  return 'Something went wrong while checking for updates.'
}
