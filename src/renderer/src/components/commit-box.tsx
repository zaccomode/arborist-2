import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import type { Worktree } from '@shared/domain'
import { pushLabel } from '@shared/working-tree'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
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
  stagedCount,
  focusToken
}: {
  repositoryId: string
  repoPath: string
  worktree: Worktree
  stagedCount: number
  /** Bumped to focus the textarea — see "Commit first" on the switch-branch dialog. */
  focusToken?: number
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // 0 is the token's own starting value, not a real request — this only
    // fires once something has actually asked for focus.
    if (focusToken) textareaRef.current?.focus()
  }, [focusToken])

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
    // An ordinary commit finishes a merge exactly the way `merge --continue`
    // does when it's run mid-merge — MERGE_HEAD clears either way, so the
    // Conflicts section needs telling regardless of which path got there.
    queryClient.invalidateQueries({ queryKey: queryKeys.conflictState(worktreePath) })
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
      // The whole `['commits', repoPath, ...]` prefix — see `useCommitLog`'s
      // doc comment on why resetting every open commit query back to page 0
      // (rather than patching one page in place) is what keeps `--skip`
      // paging safe against a commit landing mid-list.
      queryClient.invalidateQueries({ queryKey: ['commits', repoPath] })
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
  const commitLabel = amend
    ? 'Amend previous commit'
    : stagedCount > 0
      ? `Commit ${stagedCount} file${stagedCount === 1 ? '' : 's'} to ${worktree.branch ?? 'HEAD'}`
      : 'Commit'

  return (
    <div className="mt-4 border-t pt-4">
      <Textarea
        ref={textareaRef}
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

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-2 flex gap-2">
        <ButtonGroup className="flex-1">
          <Button
            data-testid="commit-button"
            className="flex-1"
            disabled={stagedCount === 0 || !message.trim() || busy !== null}
            onClick={() => void runCommit()}
          >
            {commitLabel}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={amend ? 'default' : 'outline'}
                size="icon"
                aria-label="Commit options"
                disabled={busy !== null}
              >
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuCheckboxItem
                checked={amend}
                disabled={!canAmend}
                onCheckedChange={(checked) => setAmend(checked === true)}
              >
                Amend previous commit
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
        {showPush && (
          <Button variant="outline" disabled={busy !== null} onClick={() => void runPush()}>
            {pushLabel(ahead, hasUpstream)}
          </Button>
        )}
      </div>
    </div>
  )
}
