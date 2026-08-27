import { useEffect, useState } from 'react'
import { parseAutomationScript } from '@shared/automation'
import { findUnknownTokens, substitute } from '@shared/substitution'
import type { Repository } from '@shared/persisted'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { invoke } from '@/api/client'
import { CopyableError } from '@/components/copyable-error'
import { NotesEditor } from '@/components/notes-editor'
import { ProjectConflictEditor } from '@/components/settings/project-conflict-editor'
import { ProjectPresetOverrides } from '@/components/settings/project-preset-overrides'
import { ProjectPresets } from '@/components/settings/project-presets'
import { ProjectWorktreeLocation } from '@/components/settings/project-worktree-location'

/** What the preview substitutes into, so tokens can be seen doing something. */
function sampleValues(project: Repository): Parameters<typeof substitute>[1] {
  return {
    path: `${project.path}-feature-ABC-123`,
    branch: 'feature/ABC-123',
    commitHash: '46862b9',
    repoName: project.name,
    repoPath: project.path,
    filePath: null,
    fileLine: null
  }
}

export function ProjectSettingsDialog({
  project,
  open,
  onOpenChange,
  onRemove
}: {
  project: Repository
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemove: () => void
}): React.JSX.Element {
  const [script, setScript] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  useEffect(() => {
    if (!open) return
    void invoke('automation:script', project.id).then(setScript)
  }, [open, project.id])

  const lines = parseAutomationScript(script)
  const values = sampleValues(project)
  const unknown = findUnknownTokens(script)

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await invoke('automation:setScript', project.id, script)
      onOpenChange(false)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A fixed height, matching app settings, so switching tabs moves
          nothing but the contents. */}
      <DialogContent
        data-testid="project-settings-dialog"
        className="flex h-[560px] max-h-[calc(100vh-4rem)] flex-col sm:max-w-2xl"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{project.name} settings</DialogTitle>
          <DialogDescription asChild>
            <button
              type="button"
              title="Copy path"
              onClick={() => void invoke('system:copyText', project.path)}
              className="block max-w-full truncate text-left font-mono text-xs hover:text-foreground"
            >
              {project.path}
            </button>
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="automation" className="flex min-h-0 flex-1 flex-col gap-0">
          <TabsList
            variant="line"
            className="-mx-6 w-[calc(100%+3rem)] shrink-0 rounded-none border-b px-6"
          >
            <TabsTrigger value="automation">Automation</TabsTrigger>
            <TabsTrigger value="worktrees">Worktrees</TabsTrigger>
            <TabsTrigger value="presets">Presets</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="danger">Danger zone</TabsTrigger>
          </TabsList>

          <TabsContent value="automation" className="min-h-0 flex-1 space-y-2 overflow-y-auto pt-4">
            <Label htmlFor="automation-script">Setup automation</Label>
            <Textarea
              id="automation-script"
              data-testid="automation-script"
              className="min-h-32 font-mono text-xs"
              spellCheck={false}
              placeholder={'npm install\n# comments and blank lines are skipped'}
              value={script}
              onChange={(event) => setScript(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Each line is its own command, run in order with the new worktree as its working
              directory. That means a <span className="font-mono">cd</span> on one line does not
              affect the next, and multi-line constructs will not work. Tokens:{' '}
              <span className="font-mono">
                {'{{path}} {{branch}} {{commitHash}} {{repoName}} {{repoPath}}'}
              </span>
              .
            </p>

            {unknown.length > 0 && (
              <p data-testid="unknown-tokens" className="text-xs text-amber-500">
                Unknown token{unknown.length > 1 ? 's' : ''}: {unknown.join(', ')}. They will be
                left as written.
              </p>
            )}

            {lines.some((line) => line.command) && (
              <div className="rounded-md border p-3" data-testid="automation-preview">
                <p className="text-xs font-medium text-muted-foreground">Preview</p>
                <ol className="mt-2 space-y-1">
                  {lines.map((line) =>
                    line.command === null ? (
                      <li
                        key={line.lineNumber}
                        className="font-mono text-[11px] text-muted-foreground"
                      >
                        {line.raw.trim() ? `${line.raw.trim()} — skipped` : '— blank line, skipped'}
                      </li>
                    ) : (
                      <li key={line.lineNumber} className="font-mono text-[11px]">
                        {substitute(line.command, values, 'posix')}
                      </li>
                    )
                  )}
                </ol>
              </div>
            )}
          </TabsContent>

          <TabsContent value="worktrees" className="min-h-0 flex-1 overflow-y-auto pt-4">
            <ProjectWorktreeLocation projectId={project.id} />
          </TabsContent>

          <TabsContent value="presets" className="min-h-0 flex-1 space-y-6 overflow-y-auto pt-4">
            <ProjectConflictEditor projectId={project.id} />
            <ProjectPresetOverrides projectId={project.id} />
            <ProjectPresets projectId={project.id} />
          </TabsContent>

          <TabsContent value="notes" className="min-h-0 flex-1 overflow-y-auto pt-4">
            {/* The project's own note. The worktree pane keeps per-worktree
                ones; this is the only place a note about the project itself
                belongs now that the pane behind it is an empty state. */}
            <NotesEditor
              key={project.id}
              repositoryId={project.id}
              worktreePath={null}
              heightClass="h-64"
            />
          </TabsContent>

          <TabsContent value="danger" className="min-h-0 flex-1 overflow-y-auto pt-4">
            {/* Removing the project is a project setting, and the last one
                anyone reaches for — so it lives behind a confirmation, rather
                than one slip away in the switcher's menu. */}
            <div className="flex items-center gap-3 rounded-md border border-destructive/40 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm">Remove from Arborist</p>
                <p className="text-xs text-muted-foreground">
                  The repository and its worktrees are left as they are on disk.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setConfirmingRemove(true)}>
                Remove…
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {error && <CopyableError className="text-sm" message={error} />}

        <DialogFooter className="shrink-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            Save
          </Button>
        </DialogFooter>

        <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
          <AlertDialogContent data-testid="remove-project-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {project.name} from Arborist?</AlertDialogTitle>
              <AlertDialogDescription>
                This only removes the project from Arborist. The repository, its worktrees and its
                branches are left exactly as they are on disk.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onOpenChange(false)
                  onRemove()
                }}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
