import { useEffect, useMemo, useState } from 'react'
import type { Worktree } from '@shared/domain'
import type { Repository } from '@shared/persisted'
import { useQueryClient } from '@tanstack/react-query'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sidebar } from '@/components/sidebar'
import { NoProjects, ProjectDetail } from '@/components/detail-pane'
import { WorktreeDetail } from '@/components/worktree-detail'
import { WorktreeList } from '@/components/worktree-list'
import { CreateWorktreeDialog } from '@/components/create-worktree-dialog'
import { DeleteWorktreeDialogs } from '@/components/delete-worktree'
import { ProjectSettingsDialog } from '@/components/project-settings-dialog'
import { AutomationConsole, type AutomationTarget } from '@/components/automation-console'
import { SettingsDialog } from '@/components/settings/settings-dialog'
import { useAddProject, useProjects, useRemoveProject, useWorktrees } from '@/api/queries'
import { invoke } from '@/api/client'
import { useSelection, useSelectedWorktree } from '@/state/selection'

function automationTarget(project: Repository, worktree: Worktree): AutomationTarget {
  return {
    repositoryId: project.id,
    worktreePath: worktree.path,
    values: {
      path: worktree.path,
      branch: worktree.branch,
      commitHash: worktree.status?.lastCommit?.hash ?? worktree.head,
      repoName: project.name,
      repoPath: project.path
    }
  }
}

function App(): React.JSX.Element {
  const queryClient = useQueryClient()
  const projects = useProjects()
  const addProject = useAddProject()
  const removeProject = useRemoveProject()
  const [addError, setAddError] = useState<string | null>(null)
  const [creatingWorktree, setCreatingWorktree] = useState(false)
  const [deletingWorktree, setDeletingWorktree] = useState(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [automation, setAutomation] = useState<AutomationTarget | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { projectId, selectProject, selectWorktree } = useSelection()
  const selectedWorktree = useSelectedWorktree()
  const list = useMemo(() => projects.data ?? [], [projects.data])
  const selected = list.find((project) => project.id === projectId) ?? null
  const worktrees = useWorktrees(selected?.path ?? null)
  const worktree = worktrees.data?.find((entry) => entry.path === selectedWorktree) ?? null

  useEffect(() => {
    // Land on something as soon as there is something to land on, including
    // after the selected project is removed.
    if (!selected && list.length > 0) selectProject(list[0].id)
    if (list.length === 0 && projectId) selectProject(null)
  }, [list, selected, projectId, selectProject])

  useEffect(() => {
    // The accelerators live in the application menu, which is the only way to
    // get platform-correct modifiers and, on macOS, working copy and paste.
    const unsubscribers = [
      window.arborist.subscribe('app:refresh', () => void queryClient.invalidateQueries()),
      window.arborist.subscribe('app:newWorktree', () => setCreatingWorktree(true)),
      window.arborist.subscribe('app:openSettings', () => setSettingsOpen(true))
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [queryClient])

  const handleAddProject = async (): Promise<void> => {
    setAddError(null)
    const path = await invoke('system:pickFolder')
    if (!path) return
    try {
      const added = await addProject.mutateAsync(path)
      selectProject(added.id)
    } catch (error) {
      setAddError((error as Error).message)
    }
  }

  return (
    <div className="h-screen bg-background p-2">
      <ResizablePanelGroup orientation="horizontal">
        {/* Numeric sizes are pixels: the concept's sidebar is about 260 wide. */}
        <ResizablePanel defaultSize={260} minSize={200} maxSize={420}>
          <Sidebar
            projects={list}
            selectedId={selected?.id ?? null}
            onSelect={selectProject}
            onAddProject={() => void handleAddProject()}
            onNewWorktree={() => setCreatingWorktree(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            addError={addError}
          >
            {selected && (
              <WorktreeList
                worktrees={worktrees.data ?? []}
                loading={worktrees.isPending}
                selectedPath={selectedWorktree}
                onSelect={selectWorktree}
              />
            )}
          </Sidebar>
        </ResizablePanel>
        <ResizableHandle className="mx-1 bg-transparent" />
        <ResizablePanel>
          <main className="h-full rounded-lg border bg-card">
            {!selected && <NoProjects onAddProject={() => void handleAddProject()} />}
            {selected && !worktree && (
              <ProjectDetail
                project={selected}
                onRemove={() => removeProject.mutate(selected.id)}
                onPrune={async () => {
                  await invoke('worktrees:prune', selected.path)
                  await worktrees.refetch()
                }}
                onOpenSettings={() => setProjectSettingsOpen(true)}
              />
            )}
            {selected && worktree && (
              <WorktreeDetail
                worktree={worktree}
                project={selected}
                refreshing={worktrees.isFetching}
                onRefresh={() => void worktrees.refetch()}
                onDelete={() => setDeletingWorktree(true)}
                onRunSetup={() => setAutomation(automationTarget(selected, worktree))}
              />
            )}
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>

      {selected && worktree && (
        <DeleteWorktreeDialogs
          worktree={worktree}
          repoPath={selected.path}
          open={deletingWorktree}
          onOpenChange={setDeletingWorktree}
          onDeleted={async () => {
            selectWorktree(null)
            await worktrees.refetch()
          }}
        />
      )}

      {selected && (
        <ProjectSettingsDialog
          project={selected}
          open={projectSettingsOpen}
          onOpenChange={setProjectSettingsOpen}
        />
      )}

      <AutomationConsole target={automation} onClose={() => setAutomation(null)} />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      {selected && (
        <CreateWorktreeDialog
          open={creatingWorktree}
          onOpenChange={setCreatingWorktree}
          repoPath={selected.path}
          onCreated={async (worktreePath) => {
            const { data } = await worktrees.refetch()
            selectWorktree(worktreePath)

            // A project with a setup script runs it on the worktree it was
            // written for, without anyone having to remember to.
            const script = await invoke('automation:script', selected.id)
            const created = data?.find((entry) => entry.path === worktreePath)
            if (script.trim() && created) setAutomation(automationTarget(selected, created))
          }}
        />
      )}
    </div>
  )
}

export default App
