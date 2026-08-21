import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Textarea } from '@/components/ui/textarea'
import { invoke } from '@/api/client'
import { queryKeys, useNote } from '@/api/queries'

const SAVE_DEBOUNCE_MS = 400

/**
 * Notes for a worktree, or for the project when `worktreePath` is null.
 *
 * Autosaves, and says so when a save fails: the store rejects rather than
 * swallowing, and a note that had silently stopped saving is exactly the v1
 * failure this rewrite is meant to end.
 *
 * Callers key this on the selection, so switching worktrees gets a fresh
 * editor rather than one holding the previous note's text.
 */
export function NotesEditor({
  repositoryId,
  worktreePath,
  heightClass = 'h-56'
}: {
  repositoryId: string
  worktreePath: string | null
  /** Shorter where the note shares a dialog with everything else. */
  heightClass?: string
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const saved = useNote(repositoryId, worktreePath)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<NodeJS.Timeout | null>(null)
  const unsaved = useRef<string | null>(null)

  const persist = (value: string): Promise<void> => {
    unsaved.current = null
    return invoke('notes:set', repositoryId, worktreePath, value).then(
      () => {
        setError(null)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.note(repositoryId, worktreePath)
        })
      },
      (cause: Error) => setError(cause.message)
    )
  }

  useEffect(() => {
    // Whatever is still waiting on the debounce when this unmounts has to go
    // now: switching worktrees on a half-second-old edit must not lose it.
    return () => {
      if (timer.current) clearTimeout(timer.current)
      if (unsaved.current !== null) {
        void invoke('notes:set', repositoryId, worktreePath, unsaved.current)
      }
    }
  }, [repositoryId, worktreePath])

  const scheduleSave = (value: string): void => {
    unsaved.current = value
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void persist(value), SAVE_DEBOUNCE_MS)
  }

  return (
    <section className="mt-6 flex flex-col">
      <p className="text-xs font-medium text-muted-foreground">Notes</p>
      {/* A fixed, modest height with a drag handle rather than the rest of the
          pane: notes are a side note, and anyone who wants more can drag. */}
      <Textarea
        data-testid="notes-editor"
        className={`mt-2 ${heightClass} field-sizing-fixed resize-y bg-transparent`}
        placeholder="Anything worth remembering about this worktree…"
        value={text ?? saved.data ?? ''}
        onChange={(event) => {
          setText(event.target.value)
          scheduleSave(event.target.value)
        }}
      />
      {error && <p className="mt-1 text-xs text-destructive">Not saved: {error}</p>}
    </section>
  )
}
