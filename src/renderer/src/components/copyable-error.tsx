import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { invoke } from '@/api/client'

/**
 * An inline error message with a copy affordance (#64): the exact text,
 * however long, can go straight into a bug report instead of being retyped
 * or screenshotted by hand. Text stays selectable on its own — nothing here
 * blocks that — the button is for the common case of wanting the whole
 * message at once.
 *
 * The icon is always visible rather than a hover reveal, matching every
 * other copy affordance already in the app (`Chip`'s commit-hash copy,
 * the commit inspector's hash button) rather than inventing a new pattern.
 */
export function CopyableError({
  message,
  className,
  testId
}: {
  message: string
  className?: string
  testId?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  return (
    <p data-testid={testId} className={cn('flex items-start gap-1.5 text-destructive', className)}>
      <span className="min-w-0 flex-1 select-text [overflow-wrap:anywhere]">{message}</span>
      <button
        type="button"
        title={copied ? 'Copied' : 'Copy error message'}
        onClick={() => {
          void invoke('system:copyText', message)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </p>
  )
}
