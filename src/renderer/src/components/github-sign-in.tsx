import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, KeyRound, Loader2 } from 'lucide-react'
import type { DeviceCode } from '@shared/github'
import { Button } from '@/components/ui/button'
import { CopyableError } from '@/components/copyable-error'
import { invoke } from '@/api/client'
import { queryKeys } from '@/api/queries'

/**
 * Signs in to GitHub with the device flow (#150): a code to copy, a button
 * that opens GitHub's verification page, and a wait until it is approved
 * there. Used wherever GitHub is needed and nobody is signed in yet, so the
 * clone and publish dialogs never send the user off to settings first.
 *
 * Leaving the component, by closing its dialog, cancels a sign-in still
 * waiting, so a code nobody will enter isn't polled for until it expires.
 */
export function GitHubSignIn({ reason }: { reason: string }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [code, setCode] = useState<DeviceCode | null>(null)
  const [starting, setStarting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const waiting = useRef(false)

  useEffect(
    () => () => {
      if (waiting.current) void invoke('github:cancelSignIn')
    },
    []
  )

  const start = async (): Promise<void> => {
    setError(null)
    setStarting(true)
    try {
      const issued = await invoke('github:startSignIn')
      setCode(issued)
      setCopied(false)
      waiting.current = true
      invoke('github:finishSignIn')
        .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.github }))
        .catch((cause: Error & { code?: string }) => {
          // Cancelled is this component going away, or a newer attempt
          // replacing this one: neither is anything to report.
          if (cause.code === 'github-sign-in-cancelled') return
          setCode(null)
          setError(cause.message)
        })
        .finally(() => {
          waiting.current = false
        })
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setStarting(false)
    }
  }

  if (code) {
    return (
      <div
        className="flex flex-col items-center gap-4 py-2 text-center"
        data-testid="github-sign-in"
      >
        <p className="text-sm text-muted-foreground">
          Enter this code on GitHub to let Arborist use your account.
        </p>
        <div className="flex items-center gap-2">
          <span
            className="rounded-md border bg-muted px-4 py-2 font-mono text-2xl font-semibold tracking-widest"
            data-testid="github-user-code"
          >
            {code.userCode}
          </span>
          <Button
            variant="ghost"
            size="icon"
            title={copied ? 'Copied' : 'Copy code'}
            aria-label="Copy code"
            onClick={() => {
              void invoke('system:copyText', code.userCode)
              setCopied(true)
            }}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
        <Button
          onClick={() => {
            void invoke('system:copyText', code.userCode)
            setCopied(true)
            void invoke('github:openPage', 'verification').catch((cause: Error) =>
              setError(cause.message)
            )
          }}
        >
          <ExternalLink />
          Copy code and open GitHub
        </Button>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Waiting for you to approve it on GitHub…
        </p>
        {error && <CopyableError className="text-sm" message={error} />}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center" data-testid="github-sign-in">
      <KeyRound className="size-8 text-muted-foreground" />
      <p className="max-w-sm text-sm text-muted-foreground">{reason}</p>
      <Button onClick={() => void start()} disabled={starting}>
        {starting ? <Loader2 className="animate-spin" /> : <KeyRound />}
        Sign in with GitHub
      </Button>
      {error && <CopyableError testId="github-sign-in-error" className="text-sm" message={error} />}
    </div>
  )
}
