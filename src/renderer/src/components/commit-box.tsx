import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import type { Worktree } from '@shared/domain'
import { pushLabel } from '@shared/working-tree'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { invoke } from '@/api/client'
import { queryKeys, useCommitDraft, useHasIdentity } from '@/api/queries'

const SAVE_DEBOUNCE_MS = 400

/**
 * The commit message, staged-file count, amend, and push — the bottom of
 * the Working Tree tab. The draft persists the same way `NotesEditor` does:
 * a 400ms debounced write-behind with an unmount flush, so switching
 * worktrees mid-sentence doesn't drop the last keystrokes.
 */
export function CommitBox({
  repositoryId,
  repoPath,
  worktree,
  stagedCount
}: {
  repositoryId: string
  repoPath: string
  worktree: Worktree
  stagedCount: number
}): React.JSX.Element {
  const worktreePath = worktree.path
  const queryClient = useQueryClient()
  const draft = useCommitDraft(repositoryId, worktreePath)
  const identity = useHasIdentity(worktreePath)
  const [text, setText] = useState<string | null>(null)
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState<'commit' | 'push' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsaved = useRef<string | null>(null)

  const persistDraft = (value: string): void => {
    unsaved.current = null
    void invoke('commitDraft:set', repositoryId, worktreePath, value)
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      if (unsaved.current !== null) {
        void invoke('commitDraft:set', repositoryId, worktreePath, unsaved.current)
      }
    }
  }, [repositoryId, worktreePath])

  const scheduleSave = (value: string): void => {
    unsaved.current = value
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => persistDraft(value), SAVE_DEBOUNCE_MS)
  }

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: queryKeys.worktrees(repoPath) })
    queryClient.invalidateQueries({ queryKey: queryKeys.workingTree(worktreePath) })
  }

  const message = text ?? draft.data ?? ''
  const ahead = worktree.status?.ahead ?? 0
  const hasUpstream = (worktree.status?.upstream ?? null) !== null
  // Amending something already pushed would rewrite history nobody else has
  // rebased onto yet, so it's only offered while that can't happen.
  const canAmend = ahead > 0 || !hasUpstream

  const runCommit = async (): Promise<void> => {
    setError(null)
    setBusy('commit')
    try {
      await invoke('workingTree:commit', worktreePath, message, amend)
      setText('')
      unsaved.current = null
      if (timer.current) clearTimeout(timer.current)
      await invoke('commitDraft:set', repositoryId, worktreePath, '')
      queryClient.invalidateQueries({ queryKey: queryKeys.commitDraft(repositoryId, worktreePath) })
      queryClient.invalidateQueries({
        queryKey: queryKeys.commits(repoPath, worktree.branch ?? worktree.head ?? '')
      })
      setAmend(false)
      invalidate()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const runPush = async (): Promise<void> => {
    setError(null)
    setBusy('push')
    try {
      await invoke('workingTree:push', worktreePath, worktree.branch ?? '', !hasUpstream)
      invalidate()
    } catch (cause) {
      toast.error('Push failed', { description: (cause as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const showPush = worktree.branch !== null && (ahead > 0 || !hasUpstream)
  const commitLabel =
    stagedCount > 0
      ? `Commit ${stagedCount} file${stagedCount === 1 ? '' : 's'} to ${worktree.branch ?? 'HEAD'}`
      : 'Commit'

  return (
    <div className="mt-4 border-t pt-4">
      <Textarea
        data-testid="commit-message"
        className="field-sizing-fixed h-20 resize-y bg-transparent"
        placeholder="Write your commit message…"
        value={message}
        onChange={(event) => {
          setText(event.target.value)
          scheduleSave(event.target.value)
        }}
      />

      {identity.data === false && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          No git identity configured — git will guess one from this machine for the commit author.
        </p>
      )}

      <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Checkbox
          checked={amend}
          disabled={!canAmend}
          onCheckedChange={(checked) => setAmend(checked === true)}
        />
        Amend previous commit
      </label>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-2 flex gap-2">
        <Button
          data-testid="commit-button"
          className="flex-1"
          disabled={stagedCount === 0 || !message.trim() || busy !== null}
          onClick={() => void runCommit()}
        >
          {commitLabel}
        </Button>
        {showPush && (
          <Button variant="outline" disabled={busy !== null} onClick={() => void runPush()}>
            {pushLabel(ahead, hasUpstream)}
          </Button>
        )}
      </div>
    </div>
  )
}
