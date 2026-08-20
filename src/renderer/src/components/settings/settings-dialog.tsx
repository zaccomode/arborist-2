import { useQueryClient } from '@tanstack/react-query'
import type { Settings } from '@shared/persisted'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSettings } from '@/api/queries'
import { invoke } from '@/api/client'
import { GeneralSettings } from '@/components/settings/general-settings'
import { PresetSettings } from '@/components/settings/preset-settings'

/**
 * Settings as a dialog rather than a second window. v1 used a separate window
 * because SwiftUI makes that the obvious choice; here it would mean a second
 * BrowserWindow and the IPC bookkeeping that comes with it, for a handful of
 * fields.
 */
export function SettingsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const settings = useSettings()

  const change = async (changes: Partial<Settings>): Promise<void> => {
    await invoke('settings:update', changes)
    await queryClient.invalidateQueries({ queryKey: ['settings'] })
    await queryClient.invalidateQueries({ queryKey: ['git-discovery'] })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="settings-dialog" className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Applies to every project.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="presets">Presets</TabsTrigger>
          </TabsList>
          <TabsContent value="general">
            {settings.data && (
              <GeneralSettings
                settings={settings.data}
                onChange={(changes) => void change(changes)}
              />
            )}
          </TabsContent>
          <TabsContent value="presets">
            <PresetSettings />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
