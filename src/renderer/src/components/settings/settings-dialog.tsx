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
import { DeveloperSettings } from '@/components/settings/developer-settings'
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

        {/* The tab row spans the dialog's full width, past its padding, so the
            rule under it separates the header from whichever tab is open. */}
        <Tabs defaultValue="general" className="gap-0">
          <TabsList variant="line" className="-mx-6 w-[calc(100%+3rem)] rounded-none border-b px-6">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="presets">Presets</TabsTrigger>
            <TabsTrigger value="developer">Developer</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="pt-4">
            {settings.data && (
              <GeneralSettings
                settings={settings.data}
                onChange={(changes) => void change(changes)}
              />
            )}
          </TabsContent>
          <TabsContent value="presets" className="pt-4">
            <PresetSettings />
          </TabsContent>
          <TabsContent value="developer" className="pt-4">
            {settings.data && (
              <DeveloperSettings
                settings={settings.data}
                onChange={(changes) => void change(changes)}
              />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
