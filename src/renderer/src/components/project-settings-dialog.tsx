import { useEffect, useState } from 'react'
import { parseAutomationScript } from '@shared/automation'
import { findUnknownTokens, substitute } from '@shared/substitution'
import type { Repository } from '@shared/persisted'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { invoke } from '@/api/client'
import { ProjectPresetOverrides } from '@/components/settings/project-preset-overrides'

/** What the preview substitutes into, so tokens can be seen doing something. */
function sampleValues(project: Repository): Parameters<typeof substitute>[1] {
  return {
    path: `${project.path}-feature-ABC-123`,
    branch: 'feature/ABC-123',
    commitHash: '46862b9',
    repoName: project.name,
    repoPath: project.path
  }
}

export function ProjectSettingsDialog({
  project,
  open,
  onOpenChange
}: {
  project: Repository
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [script, setScript] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      <DialogContent
        data-testid="project-settings-dialog"
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>{project.name} settings</DialogTitle>
          <DialogDescription>Settings for this project alone.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
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
        </div>

        {unknown.length > 0 && (
          <p data-testid="unknown-tokens" className="text-xs text-amber-500">
            Unknown token{unknown.length > 1 ? 's' : ''}: {unknown.join(', ')}. They will be left as
            written.
          </p>
        )}

        {lines.some((line) => line.command) && (
          <div className="rounded-md border p-3" data-testid="automation-preview">
            <p className="text-xs font-medium text-muted-foreground">Preview</p>
            <ol className="mt-2 space-y-1">
              {lines.map((line) =>
                line.command === null ? (
                  <li key={line.lineNumber} className="font-mono text-[11px] text-muted-foreground">
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

        <ProjectPresetOverrides projectId={project.id} />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
