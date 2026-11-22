import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyableError } from '@/components/copyable-error'
import { GitHubSignIn } from '@/components/github-sign-in'
import { invoke } from '@/api/client'
import { queryKeys, useGitHubStatus } from '@/api/queries'

/**
 * The GitHub account Arborist clones and publishes as (#150). Signing out
 * forgets the token on this computer; it doesn't revoke it on GitHub, which
 * is done from the account's Applications settings there.
 */
export function GitHubSettings(): React.JSX.Element {
  const queryClient = useQueryClient()
  const status = useGitHubStatus()
  const [error, setError] = useState<string | null>(null)

  if (status.isPending) return <Skeleton className="h-24 w-full" />
  if (status.isError) return <CopyableError className="text-sm" message={status.error.message} />

  const account = status.data.account
  return (
    <div className="space-y-6 py-2" data-testid="github-settings">
      <section className="space-y-2">
        <Label>Account</Label>
        {account ? (
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" data-testid="github-account">
                {account.login}
              </p>
              {account.name && (
                <p className="truncate text-xs text-muted-foreground">{account.name}</p>
              )}
            </div>
            <Button
              variant="outline"
              onClick={async () => {
                setError(null)
                try {
                  await invoke('github:signOut')
                  await queryClient.invalidateQueries({ queryKey: queryKeys.github })
                } catch (cause) {
                  setError((cause as Error).message)
                }
              }}
            >
              Sign out
            </Button>
          </div>
        ) : (
          <div className="rounded-md border px-3 py-4">
            <GitHubSignIn reason="Sign in to clone your repositories and publish new ones." />
          </div>
        )}
        {!status.data.remembers && (
          <p className="text-xs text-muted-foreground">
            This system has no keychain Arborist can keep the sign-in in, so you&apos;ll need to
            sign in again each time Arborist starts.
          </p>
        )}
        {error && <CopyableError className="text-sm" message={error} />}
      </section>

      <section className="space-y-2">
        <Label>Accounts and organisations</Label>
        <p className="text-xs text-muted-foreground">
          Arborist sees the repositories of the accounts and organisations its GitHub App is
          installed on. Install it on another to clone from or publish to it.
        </p>
        <Button variant="outline" onClick={() => void invoke('github:openPage', 'install')}>
          <Plus />
          Add an account or organisation
        </Button>
      </section>
    </div>
  )
}
