import { EventEmitter } from 'events'
import { describe, it, expect, vi } from 'vitest'
import type { AppUpdater } from 'electron-updater'
import { UpdateService, type UpdateServiceDeps } from '../../src/main/services/updates'
import type { UpdateStatus } from '../../src/shared/updates'
import { updateErrorMessage } from '../../src/shared/updates'

/**
 * Just enough of electron-updater to drive the state machine: the events it
 * emits, and the two methods the service calls. Nothing here talks to a
 * network or an installer, which is the point — the policy under test is
 * "what does the user see, and when does the app restart itself".
 */
class FakeUpdater extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = false
  checkForUpdates = vi.fn(async () => null)
  quitAndInstall = vi.fn()
}

function harness(supported = true): {
  updater: FakeUpdater
  service: UpdateService
  seen: UpdateStatus[]
  /** What the service sent to the main-process log, raw error and all. */
  logged: { message: string; error: unknown }[]
} {
  const updater = new FakeUpdater()
  const seen: UpdateStatus[] = []
  const logged: { message: string; error: unknown }[] = []
  const deps: UpdateServiceDeps = {
    updater: updater as unknown as AppUpdater,
    emit: (status) => seen.push(status),
    currentVersion: '1.2.0',
    supported,
    log: (message, error) => logged.push({ message, error })
  }
  return { updater, service: new UpdateService(deps), seen, logged }
}

describe('UpdateService', () => {
  it('downloads in the background but never installs on its own', () => {
    const { updater } = harness()

    expect(updater.autoDownload).toBe(true)
    // Staged for the next ordinary quit — the app is not the one choosing
    // when someone's session ends.
    expect(updater.autoInstallOnAppQuit).toBe(true)
  })

  it('walks from a check to a ready update', async () => {
    const { updater, service, seen } = harness()

    await service.check(false)
    updater.emit('checking-for-update')
    updater.emit('update-available', { version: '1.3.0' })
    updater.emit('download-progress', { percent: 42.4 })
    updater.emit('update-downloaded', { version: '1.3.0' })

    expect(seen.map((status) => status.phase)).toEqual([
      'checking',
      'available',
      'downloading',
      'ready'
    ])
    expect(seen[2]).toMatchObject({ percent: 42, version: '1.3.0' })
    expect(service.status).toEqual({ phase: 'ready', version: '1.3.0' })
    expect(service.hasStagedUpdate).toBe(true)
  })

  it('marks a check the user asked for, so the UI can answer it', async () => {
    const { updater, service } = harness()

    await service.check(true)
    updater.emit('update-not-available', {})

    expect(service.status).toMatchObject({ phase: 'up-to-date', manual: true })
  })

  it('leaves a scheduled check unmarked, so it passes in silence', async () => {
    const { updater, service } = harness()

    await service.check(false)
    updater.emit('update-not-available', {})

    expect(service.status).toMatchObject({ phase: 'up-to-date', manual: false })
  })

  it('does not carry the manual flag into the next check', async () => {
    const { updater, service } = harness()

    await service.check(true)
    updater.emit('update-not-available', {})
    await service.check(false)
    updater.emit('error', new Error('getaddrinfo ENOTFOUND'))

    expect(service.status).toMatchObject({ phase: 'error', manual: false })
  })

  it('reports a check that throws rather than leaving the UI checking forever', async () => {
    const { updater, service } = harness()
    updater.checkForUpdates.mockRejectedValueOnce(new Error('403 from the release feed'))

    await service.check(true)

    expect(service.status).toMatchObject({
      phase: 'error',
      manual: true,
      message: updateErrorMessage(new Error('403 from the release feed'))
    })
  })

  // The v3.4.0 incident, from the app's side: the release went out without
  // its `latest-mac.yml`, so every check 404ed and the whole HttpError dump
  // — request URL, response headers, stack — went into the toast verbatim.
  it('tells the user a release is missing its manifest, without the HTTP dump', async () => {
    const { updater, service, seen, logged } = harness()
    const raw = Object.assign(
      new Error(
        'Unable to find latest version on GitHub (https://github.com/zaccomode/arborist-2/releases.atom), ' +
          'please ensure a production release exists: HttpError: 404 Not Found\n' +
          '"method: GET url: https://github.com/.../latest-mac.yml"\n' +
          'Headers: {"server":"Varnish"}'
      ),
      { code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' }
    )

    await service.check(true)
    updater.emit('error', raw)

    const status = seen.at(-1) as { phase: string; message: string }
    expect(status.phase).toBe('error')
    expect(status.message).toBe(
      'This release is missing its update information, so Arborist cannot tell whether a newer version exists. Nothing is wrong with your copy.'
    )
    // The things that used to reach the user, and now must not.
    expect(status.message).not.toMatch(/HttpError|Headers|url:|404/)
    // Nothing is thrown away, though: the dump goes to the log instead.
    expect(logged).toHaveLength(1)
    expect(logged[0]?.error).toBe(raw)
  })

  it('logs the raw error from a check that throws, as well as from the event', async () => {
    const { updater, service, logged } = harness()
    const thrown = new Error('getaddrinfo ENOTFOUND github.com')
    updater.checkForUpdates.mockRejectedValueOnce(thrown)

    await service.check(true)

    expect(logged.map((entry) => entry.error)).toEqual([thrown])
    expect(service.status).toMatchObject({
      message: 'Arborist could not reach GitHub. Check your internet connection and try again.'
    })
  })

  it('answers a check against a staged update without downloading it again', async () => {
    const { updater, service } = harness()
    await service.check(false)
    updater.emit('update-downloaded', { version: '1.3.0' })
    updater.checkForUpdates.mockClear()

    const status = await service.check(true)

    expect(status).toEqual({ phase: 'ready', version: '1.3.0' })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('installs only from a ready state', () => {
    const { updater, service } = harness()

    service.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    updater.emit('update-downloaded', { version: '1.3.0' })
    service.install()
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('ignores a second restart while the first is under way', () => {
    const { updater, service } = harness()
    updater.emit('update-downloaded', { version: '1.3.0' })

    service.install()
    service.install()

    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('says a dev build is up to date rather than that something failed', async () => {
    const { updater, service } = harness(false)

    const status = await service.check(true)

    expect(status.phase).toBe('up-to-date')
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(service.support()).toEqual({ supported: false, currentVersion: '1.2.0' })
  })

  it('does not start a schedule in a build that cannot update', () => {
    const { updater, service } = harness(false)

    service.start()

    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })
})

/**
 * The mapping on its own. Every input here is the shape `electron-updater`
 * really throws — an `HttpError` with a status, the GitHub provider's wrapper
 * with the original folded into its message, or a bare socket errno — rather
 * than a string invented for the test, because the whole value of the mapping
 * is that it recognises the real ones.
 */
describe('updateErrorMessage', () => {
  const missing =
    'This release is missing its update information, so Arborist cannot tell whether a newer version exists. Nothing is wrong with your copy.'
  const offline = 'Arborist could not reach GitHub. Check your internet connection and try again.'
  const serverError =
    'GitHub could not serve the update information just now. Try again in a few minutes.'
  const refused =
    'GitHub turned the update check away, usually because of its rate limit. Try again in a few minutes.'

  /** `builder-util-runtime`'s own `HttpError`, as it reaches the service. */
  function httpError(statusCode: number, statusMessage: string): Error {
    return Object.assign(
      new Error(`${statusCode} ${statusMessage}\nHeaders: {"server":"Varnish"}`),
      {
        statusCode,
        code: `HTTP_ERROR_${statusCode}`
      }
    )
  }

  /** `GitHubProvider.getLatestVersion` re-throwing with the stack inlined. */
  function wrapped(inner: string): Error {
    return Object.assign(
      new Error(
        'Unable to find latest version on GitHub (https://github.com/zaccomode/arborist-2/releases.atom), ' +
          `please ensure a production release exists: ${inner}`
      ),
      { code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' }
    )
  }

  it('reads a missing manifest off an HttpError', () => {
    expect(updateErrorMessage(httpError(404, 'Not Found'))).toBe(missing)
  })

  it('reads one off the provider wrapper too, which is what the UI actually gets', () => {
    expect(updateErrorMessage(wrapped('HttpError: 404 Not Found'))).toBe(missing)
  })

  // The wrapper's code says only "no latest version", so a 500 inside it has
  // to be classified from the status in the message or it reads as a missing
  // manifest — a broken release, when GitHub is the one having trouble.
  it('does not read every provider wrapper as a missing manifest', () => {
    expect(updateErrorMessage(wrapped('HttpError: 503 Service Unavailable'))).toBe(serverError)
    expect(updateErrorMessage(wrapped('HttpError: 403 Forbidden'))).toBe(refused)
  })

  it('reads a network failure as a network failure', () => {
    expect(updateErrorMessage(new Error('getaddrinfo ENOTFOUND github.com'))).toBe(offline)
    expect(
      updateErrorMessage(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
    ).toBe(offline)
    expect(updateErrorMessage(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe(offline)
    expect(updateErrorMessage(new Error('socket hang up'))).toBe(offline)
  })

  // A proxy that refuses the request answers with a status of its own, and
  // the user's problem is still the connection rather than GitHub.
  it('prefers the network reading when a status comes with a transport error', () => {
    expect(
      updateErrorMessage(
        Object.assign(httpError(502, 'Bad Gateway'), {
          code: 'ERR_PROXY_CONNECTION_FAILED'
        })
      )
    ).toBe(offline)
  })

  it('separates GitHub being unwell from GitHub refusing', () => {
    expect(updateErrorMessage(httpError(500, 'Internal Server Error'))).toBe(serverError)
    expect(updateErrorMessage(httpError(429, 'Too many requests'))).toBe(refused)
    expect(updateErrorMessage(httpError(401, 'Unauthorized'))).toBe(refused)
  })

  it('says nothing was installed when a download cannot be verified', () => {
    const expected = 'The downloaded update could not be verified, so it was not installed.'
    expect(
      updateErrorMessage(
        Object.assign(new Error('New version 3.4.0 is not signed by the application owner: ...'), {
          code: 'ERR_UPDATER_INVALID_SIGNATURE'
        })
      )
    ).toBe(expected)
    expect(updateErrorMessage(new Error('sha512 checksum mismatch, expected ..., got ...'))).toBe(
      expected
    )
  })

  it('falls back to a plain sentence rather than guessing', () => {
    const plain = 'Something went wrong while checking for updates.'
    expect(updateErrorMessage(new Error('Cannot find module ...'))).toBe(plain)
    expect(updateErrorMessage(undefined)).toBe(plain)
    expect(updateErrorMessage('a string nobody expected')).toBe(plain)
  })

  // A version number is not a status code, and a release note is not an HTTP
  // header: both used to be close enough to trip a looser match.
  it('does not take a 404 inside a version number for a status', () => {
    expect(updateErrorMessage(new Error('version 1.404.0 could not be parsed'))).toBe(
      'Something went wrong while checking for updates.'
    )
  })

  it('never returns the raw text it was given', () => {
    const raw = 'HttpError: 404 Not Found\nmethod: GET url: https://github.com/x/latest-mac.yml'
    expect(updateErrorMessage(new Error(raw))).not.toContain('url:')
  })
})
