import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import type { ChangedFile, Worktree } from '@shared/domain'
import type { ConflictState } from '@shared/conflicts'
import { canKeepOurs, conflictBannerText, conflictCodeLabel } from '@shared/conflicts'
import { filterForTarget, resolveConflictEditorPreset } from '@shared/presets'
import { joinPath, normaliseGitPath } from '@shared/paths'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { FilePathCell } from '@/components/file-path-cell'
import { PresetConsole, type PresetRun } from '@/components/preset-console'
import { invoke } from '@/api/client'
import { queryKeys, usePresets, useProjectSettings, useSettings } from '@/api/queries'

/**
 * One conflicted file's row: no checkbox — staging half a conflict is
 * meaningless — a destructive-toned code badge in place of the ordinary
 * status badge, and its actions. "Keep ours" only ever shows on `UU`; see
 * `canKeepOurs`.
 */
function ConflictRow({
  file,
  defaultPresetId,
  otherPresets,
  busy,
  onOpen,
  onMarkResolved,
  onKeepOurs
}: {
  file: ChangedFile
  defaultPresetId: string | undefined
  otherPresets: Array<{ id: string; name: string }>
  busy: boolean
  onOpen: (presetId: string) => void
  onMarkResolved: () => void
  onKeepOurs: () => void
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-sm">
      <FilePathCell path={file.path} />
      <Badge variant="destructive" className="shrink-0 font-mono text-[11px]">
        {file.conflict}
      </Badge>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {file.conflict ? conflictCodeLabel(file.conflict) : ''}
      </span>
      <Button
        size="sm"
        disabled={!defaultPresetId || busy}
        onClick={() => defaultPresetId && onOpen(defaultPresetId)}
      >
        Open in editor
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            aria-label={`${file.path} conflict actions`}
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {otherPresets.map((preset) => (
            <DropdownMenuItem key={preset.id} onSelect={() => onOpen(preset.id)}>
              Open in {preset.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={onMarkResolved}>Mark resolved</DropdownMenuItem>
          {canKeepOurs(file.conflict) && (
            <DropdownMenuItem onSelect={onKeepOurs}>Keep ours (discard theirs)</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/**
 * The Working Tree tab's Conflicts section, above Changed Files: a banner
 * naming the operation in progress, one row per `u` record, and a footer to
 * abort or (once every row is gone) continue. Stays visible for as long as
 * `conflictState.operation` is non-null — including the moment after the
 * last conflict is marked resolved but before `--continue` has actually run,
 * which is exactly when Continue needs to be on screen.
 */
export function ConflictSection({
  repositoryId,
  repoPath,
  repoName,
  worktree,
  files,
  conflictState,
  onChanged
}: {
  repositoryId: string
  repoPath: string
  repoName: string
  worktree: Worktree
  /** The `u`-record files only — possibly empty once every conflict is resolved. */
  files: ChangedFile[]
  /**
   * `operation` is null for a `u` record with no merge/rebase/cherry-pick/
   * revert behind it — a stash pop that conflicted, say (verified: `stash
   * pop` never writes `MERGE_HEAD`). The section still shows in that case,
   * banner and rows and all; only the Abort/Continue footer needs a real
   * operation to act on, so it's the one part that disappears.
   */
  conflictState: ConflictState
  onChanged: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const worktreePath = worktree.path
  const presets = usePresets(repoPath, repositoryId)
  const projectSettings = useProjectSettings(repositoryId)
  const settings = useSettings()
  const [consoleRun, setConsoleRun] = useState<PresetRun | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [footerBusy, setFooterBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filePresets = filterForTarget(presets.data ?? [], 'file')
  const configuredId =
    projectSettings.data?.conflictEditorPresetId ?? settings.data?.conflictEditorPresetId ?? null
  const defaultPreset = resolveConflictEditorPreset(configuredId, filePresets)
  const otherPresets = filePresets.filter((preset) => preset.id !== defaultPreset?.id)

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: queryKeys.conflictState(worktreePath) })
    onChanged()
  }

  const openInEditor = async (file: ChangedFile, presetId: string): Promise<void> => {
    setError(null)
    setBusyPath(file.path)
    try {
      const result = await invoke(
        'presets:run',
        presetId,
        {
          path: worktree.path,
          branch: worktree.branch,
          commitHash: worktree.status?.lastCommit?.hash ?? worktree.head,
          repoName,
          repoPath,
          filePath: joinPath(
            window.arborist.platform,
            worktree.path,
            normaliseGitPath(file.path, window.arborist.platform)
          ),
          fileLine: null,
          projectId: repositoryId
        },
        'file'
      )
      if (result.kind === 'console') setConsoleRun(result)
    } catch (cause) {
      toast.error('Could not open', { description: (cause as Error).message })
    } finally {
      setBusyPath(null)
    }
  }

  const markResolved = async (file: ChangedFile): Promise<void> => {
    setError(null)
    setBusyPath(file.path)
    try {
      await invoke('workingTree:stage', worktreePath, [file.path])
      invalidate()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusyPath(null)
    }
  }

  const keepOurs = async (file: ChangedFile): Promise<void> => {
    setError(null)
    setBusyPath(file.path)
    try {
      await invoke('conflicts:keepOurs', worktreePath, file.path)
      invalidate()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusyPath(null)
    }
  }

  const abort = async (): Promise<void> => {
    const operation = conflictState.operation
    if (!operation) return
    setError(null)
    setFooterBusy(true)
    try {
      await invoke('conflicts:abort', worktreePath, operation)
      toast('Aborted.')
      invalidate()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setFooterBusy(false)
    }
  }

  const continueOperation = async (): Promise<void> => {
    const operation = conflictState.operation
    if (!operation) return
    setError(null)
    setFooterBusy(true)
    try {
      await invoke('conflicts:continue', worktreePath, operation)
      toast('Continued.')
      invalidate()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setFooterBusy(false)
    }
  }

  const banner = conflictBannerText(conflictState, files.length)

  return (
    <div
      className="mb-4 overflow-hidden rounded-lg border border-destructive/40"
      data-testid="conflict-section"
    >
      <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium">
        {banner}
      </div>

      {files.length > 0 && (
        <ul data-testid="conflict-files" className="divide-y">
          {files.map((file) => (
            <ConflictRow
              key={file.path}
              file={file}
              defaultPresetId={defaultPreset?.id}
              otherPresets={otherPresets}
              busy={busyPath === file.path}
              onOpen={(presetId) => void openInEditor(file, presetId)}
              onMarkResolved={() => void markResolved(file)}
              onKeepOurs={() => void keepOurs(file)}
            />
          ))}
        </ul>
      )}

      {error && <p className="px-3 py-1.5 text-xs text-destructive">{error}</p>}

      {/* No git operation to abort or continue for a `u` record with no
          MERGE_HEAD/etc behind it (a conflicting stash pop) — resolving those
          rows above, or dropping the stash from the Stash section, is the
          whole story, so the footer has nothing useful to offer. */}
      {conflictState.operation && (
        <div className="flex items-center justify-end gap-2 border-t border-destructive/40 px-3 py-2">
          <Button size="sm" variant="outline" disabled={footerBusy} onClick={() => void abort()}>
            Abort
          </Button>
          {files.length === 0 && (
            <Button size="sm" disabled={footerBusy} onClick={() => void continueOperation()}>
              Continue
            </Button>
          )}
        </div>
      )}

      <PresetConsole run={consoleRun} onClose={() => setConsoleRun(null)} />
    </div>
  )
}
