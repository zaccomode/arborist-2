import { toast, type ExternalToast } from 'sonner'
import { invoke } from '@/api/client'

/**
 * `toast.error`, with a "Copy" action wired to the same clipboard flow every
 * other copy affordance in the app uses (#64) — so the message behind a
 * failure can go straight into a bug report instead of being retyped from a
 * screenshot. `swipeDirections={[]}` on the app's `<Toaster>` is the other
 * half of #64: without it, dragging across the toast to select its text
 * instead triggers Sonner's own swipe-to-dismiss gesture.
 */
export function showErrorToast(title: string, options?: ExternalToast): void {
  const description = typeof options?.description === 'string' ? options.description : undefined
  const copyText = description ? `${title}\n\n${description}` : title

  toast.error(title, {
    ...options,
    action: {
      label: 'Copy',
      onClick: () => void invoke('system:copyText', copyText)
    }
  })
}
