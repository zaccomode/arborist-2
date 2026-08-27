import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { GitDiscoveryResult } from '@shared/domain'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CopyableError } from '@/components/copyable-error'
import { invoke } from '@/api/client'

/**
 * Nothing in the app works without git, so discovery gates the whole UI:
 * every other screen can assume a working binary rather than handling its
 * absence at each call site.
 */
export function GitGate({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const [discovery, setDiscovery] = useState<GitDiscoveryResult | null>(null)

  useEffect(() => {
    void invoke('git:discover').then(setDiscovery)
  }, [])

  if (!discovery) return null
  if (discovery.found) return <>{children}</>

  return <GitNotFound discovery={discovery} onResolved={setDiscovery} />
}

/** Only the platform in front of the user; the other download is no help. */
function installLink(platform: NodeJS.Platform): { href: string; label: string } {
  switch (platform) {
    case 'darwin':
      return { href: 'https://git-scm.com/download/mac', label: 'Install on macOS' }
    case 'win32':
      return { href: 'https://git-scm.com/download/win', label: 'Install on Windows' }
    default:
      return { href: 'https://git-scm.com/downloads', label: 'Install git' }
  }
}

function GitNotFound({
  discovery,
  onResolved
}: {
  discovery: GitDiscoveryResult
  onResolved: (result: GitDiscoveryResult) => void
}): React.JSX.Element {
  const [path, setPath] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(discovery.overrideError)
  const install = installLink(window.arborist.platform)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setChecking(true)
    setError(null)
    try {
      const result = await invoke('git:setPath', path)
      if (result.found) {
        onResolved(result)
      } else {
        setError(result.overrideError ?? `${path} is not a working git executable.`)
      }
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div
      data-testid="git-not-found"
      className="flex h-screen items-center justify-center bg-background p-8"
    >
      <div className="w-full max-w-md">
        <AlertTriangle className="size-8 text-destructive" />
        <h1 className="mt-4 text-xl font-semibold">Git not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Arborist runs your installed copy of git, and could not find one. Install git, or point
          Arborist at it directly.
        </p>

        <div className="mt-4">
          <Button asChild variant="outline" size="sm">
            <a href={install.href} target="_blank" rel="noreferrer">
              {install.label}
            </a>
          </Button>
        </div>

        <form className="mt-6 space-y-2" onSubmit={submit}>
          <Label htmlFor="git-path">Path to the git executable</Label>
          <div className="flex gap-2">
            <Input
              id="git-path"
              value={path}
              placeholder={
                window.arborist.platform === 'win32'
                  ? 'C:\\Program Files\\Git\\cmd\\git.exe'
                  : '/usr/local/bin/git'
              }
              spellCheck={false}
              onChange={(event) => setPath(event.target.value)}
            />
            <Button type="submit" disabled={checking || path.trim().length === 0}>
              Use this
            </Button>
          </div>
          {error && <CopyableError className="text-sm" message={error} />}
        </form>
      </div>
    </div>
  )
}
