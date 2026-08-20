import type { Settings } from '@shared/persisted'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/**
 * Settings that exist for working out what Arborist did, rather than for
 * changing what it does. Kept apart from General so the everyday screen stays
 * about theme, git and shells.
 */
export function DeveloperSettings({
  settings,
  onChange
}: {
  settings: Settings
  onChange: (changes: Partial<Settings>) => void
}): React.JSX.Element {
  return (
    <div className="space-y-6 py-2">
      <section className="flex items-center justify-between gap-6">
        <div>
          <Label htmlFor="debug-git">Log every git command</Label>
          <p className="text-xs text-muted-foreground">
            Writes each git command Arborist runs to the application log, so a surprising result can
            be traced back to the command that produced it. Off by default, because it is a lot of
            output for a normal session.
          </p>
        </div>
        <Switch
          id="debug-git"
          checked={settings.debugGit}
          onCheckedChange={(debugGit) => onChange({ debugGit })}
        />
      </section>
    </div>
  )
}
