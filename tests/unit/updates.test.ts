import { EventEmitter } from 'events'
import { describe, it, expect, vi } from 'vitest'
import type { AppUpdater } from 'electron-updater'
import { UpdateService, type UpdateServiceDeps } from '../../src/main/services/updates'
import type { UpdateStatus } from '../../src/shared/updates'

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
} {
  const updater = new FakeUpdater()
  const seen: UpdateStatus[] = []
  const deps: UpdateServiceDeps = {
    updater: updater as unknown as AppUpdater,
    emit: (status) => seen.push(status),
    currentVersion: '1.2.0',
    supported
  }
  return { updater, service: new UpdateService(deps), seen }
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

    expect(service.status).toMatchObject({ phase: 'error', manual: true })
    expect((service.status as { message: string }).message).toMatch(/403/)
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
