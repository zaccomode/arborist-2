import { useEffect } from 'react'
import { toast } from 'sonner'
import type { UpdateStatus } from '@shared/updates'
import { invoke } from '@/api/client'
import { Button } from '@/components/ui/button'

/** Fixed ids, so a transition replaces the toast rather than stacking on it. */
const TOAST_ID = 'update'

function show(status: UpdateStatus): void {
  switch (status.phase) {
    case 'ready':
      toast.success('Update ready', {
        id: TOAST_ID,
        description: `Arborist ${status.version} installs the next time you quit.`,
        duration: Infinity,
        // Wider than the default toast: this one carries a sentence and a
        // button, and at the default width the sentence wraps to three lines
        // against a button squeezed to the edge.
        style: { '--width': '26rem' } as React.CSSProperties,
        action: (
          // Sonner's own `action` renders a link-sized control; this is a
          // decision worth a real button, since the app disappears when it
          // is pressed.
          <Button size="sm" className="ml-auto" onClick={() => void invoke('updates:install')}>
            Restart now
          </Button>
        )
      })
      return

    case 'up-to-date':
      // Only the menu's check gets an answer. The six-hourly one saying
      // "you're up to date" at someone all day would be noise.
      if (status.manual) {
        toast.success("You're up to date", { id: TOAST_ID })
      }
      return

    case 'error':
      // Same reasoning: a background check failing usually means the network
      // is down, which is not Arborist's news to break.
      if (status.manual) {
        toast.error('Could not check for updates', {
          id: TOAST_ID,
          description: status.message
        })
      }
      return

    // Checking, finding, and downloading all happen without asking, so they
    // pass in silence; `ready` is the first thing worth a word.
    default:
      return
  }
}

/**
 * The update lifecycle, as toasts.
 *
 * Nothing here restarts the app on its own. A downloaded update waits for the
 * button, or for the next ordinary quit — losing a running setup script to an
 * update nobody agreed to is the failure this is written to avoid.
 */
export function UpdateToasts(): null {
  useEffect(() => {
    const unsubscribe = window.arborist.subscribe('updates:changed', show)
    // A window that opens after a download finished has missed the push, so
    // it asks once for the state it would otherwise never hear about.
    void invoke('updates:status').then(show)
    return unsubscribe
  }, [])

  return null
}
