import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sidebar } from '@/components/sidebar'
import { NoProjects, ProjectDetail } from '@/components/detail-pane'
import { WorktreeDetail } from '@/components/worktree-detail'
import { WorktreeList } from '@/components/worktree-list'
import { CreateWorktreeDialog } from '@/components/create-worktree-dialog'
import { DeleteWorktreeDialogs } from '@/components/delete-worktree'
import { useAddProject, useProjects, useRemoveProject, useWorktrees } from '@/api/queries'
import { invoke } from '@/api/client'
import { useSelection, useSelectedWorktree } from '@/state/selection'

function App(): React.JSX.Element {
  const queryClient = useQueryClient()
  const projects = useProjects()
  const addProject = useAddProject()
  const removeProject = useRemoveProject()
  const [addError, setAddError] = useState<string | null>(null)
  const [creatingWorktree, setCreatingWorktree] = useState(false)
  const [deletingWorktree, setDeletingWorktree] = useState(false)

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
    // Cmd/Ctrl-R refreshes, the way it does everywhere else. #18 moves this
    // to the application menu alongside the rest of the shortcuts.
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        void queryClient.invalidateQueries()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
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
              />
            )}
            {selected && worktree && (
              <WorktreeDetail
                worktree={worktree}
                repositoryId={selected.id}
                refreshing={worktrees.isFetching}
                onRefresh={() => void worktrees.refetch()}
                onDelete={() => setDeletingWorktree(true)}
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
        <CreateWorktreeDialog
          open={creatingWorktree}
          onOpenChange={setCreatingWorktree}
          repoPath={selected.path}
          onCreated={async (worktreePath) => {
            await worktrees.refetch()
            selectWorktree(worktreePath)
          }}
        />
      )}
    </div>
  )
}

export default App
