import { useEffect, useState } from 'react'
import type { UpdateStatus, UpdateSupport } from '@shared/updates'
import { formatRelativeDate } from '@shared/format'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { invoke } from '@/api/client'

/**
 * What the status line says for each phase of the update lifecycle (#65).
 * Deliberately more talkative than `update-notice.tsx`'s toasts: those only
 * ever say something worth interrupting someone over, where this is read on
 * demand, so every phase — including the quiet ones a toast skips — gets a
 * line.
 */
function statusLine(status: UpdateStatus | null): string {
  if (!status) return 'Checking…'
  switch (status.phase) {
    case 'idle':
      return 'Not checked yet.'
    case 'checking':
      return 'Checking for updates…'
    case 'up-to-date':
      return `You're up to date, checked ${formatRelativeDate(status.checkedAt)}.`
    case 'available':
      return `Arborist ${status.version} is available and downloading.`
    case 'downloading':
      return `Downloading Arborist ${status.version}… ${status.percent}%`
    case 'ready':
      return `Arborist ${status.version} is ready — it installs the next time you quit.`
    case 'error':
      return `Could not check for updates: ${status.message}`
  }
}

/**
 * The app version and a manual "Check for Updates" (#65), for platforms
 * whose native menu has no application-level menu to hang this off — every
 * platform but macOS, in practice, though this tab shows for all of them so
 * the version is always visible somewhere.
 *
 * Reuses the exact IPC surface the macOS menu item and the update toasts
 * already stand on (`updates:support`/`updates:status`/`updates:check`,
 * pushed on `updates:changed`) rather than growing a second way to ask. The
 * button itself is never hidden behind `support.supported` — a dev or
 * unpacked build has nowhere to install an update, but `updates:check`
 * already answers that gracefully with "up to date" rather than an error
 * (`UpdateService.check`), and the macOS menu item makes the same call: show
 * it unconditionally, exactly where a user goes looking for it, rather than
 * making it disappear for a reason that means nothing to them.
 */
export function AboutSettings(): React.JSX.Element {
  const [support, setSupport] = useState<UpdateSupport | null>(null)
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    void invoke('updates:support').then(setSupport)
    void invoke('updates:status').then(setStatus)
    return window.arborist.subscribe('updates:changed', setStatus)
  }, [])

  const checking = status?.phase === 'checking'

  return (
    <div className="space-y-6 py-2">
      <section className="space-y-1">
        <Label>Version</Label>
        <p className="text-sm text-muted-foreground" data-testid="app-version">
          {support ? `Arborist ${support.currentVersion}` : 'Arborist'}
        </p>
      </section>

      <section className="space-y-2">
        <Label>Updates</Label>
        <p className="text-xs text-muted-foreground" data-testid="update-status">
          {statusLine(status)}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={checking}
          onClick={() => void invoke('updates:check').then(setStatus)}
        >
          Check for Updates…
        </Button>
      </section>
    </div>
  )
}
