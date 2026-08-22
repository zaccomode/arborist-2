import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { RemoteBranch, Worktree } from '@shared/domain'
import type { Repository } from '@shared/persisted'
import { useQueryClient } from '@tanstack/react-query'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sidebar } from '@/components/sidebar'
import { NoProjects, NoWorktreeSelected } from '@/components/detail-pane'
import { WorktreeDetail } from '@/components/worktree-detail'
import { WorktreeList } from '@/components/worktree-list'
import { RemoteBranchList } from '@/components/remote-branch-list'
import { RemoteBranchDetail } from '@/components/remote-branch-detail'
import { CreateWorktreeDialog } from '@/components/create-worktree-dialog'
import { DeleteWorktreeDialogs } from '@/components/delete-worktree'
import { ProjectSettingsDialog } from '@/components/project-settings-dialog'
import { AutomationConsole, type AutomationTarget } from '@/components/automation-console'
import { SettingsDialog } from '@/components/settings/settings-dialog'
import {
  useAddProject,
  useFetch,
  useProjects,
  useRemoteBranches,
  useRemoveProject,
  useSettings,
  useWorktrees
} from '@/api/queries'
import { invoke } from '@/api/client'
import { samePath } from '@/lib/paths'
import { useSelection, useSelectedRemoteBranch, useSelectedWorktree } from '@/state/selection'

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
  const fetchProject = useFetch()
  const settings = useSettings()
  const [addError, setAddError] = useState<string | null>(null)
  const [creatingWorktree, setCreatingWorktree] = useState(false)
  const [trackingRemote, setTrackingRemote] = useState<RemoteBranch | null>(null)
  const [deletingWorktree, setDeletingWorktree] = useState(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [automation, setAutomation] = useState<AutomationTarget | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { projectId, selectProject, selectWorktree, selectRemoteBranch } = useSelection()
  const selectedWorktree = useSelectedWorktree()
  const selectedRemoteBranchName = useSelectedRemoteBranch()
  const list = useMemo(() => projects.data ?? [], [projects.data])
  const selected = list.find((project) => project.id === projectId) ?? null
  const worktrees = useWorktrees(selected?.path ?? null)
  const worktree = worktrees.data?.find((entry) => samePath(entry.path, selectedWorktree)) ?? null
  const remoteBranches = useRemoteBranches(selected?.path ?? null)
  const remoteBranch =
    remoteBranches.data?.find((entry) => entry.name === selectedRemoteBranchName) ?? null
  const mainWorktree = worktrees.data?.find((entry) => entry.isMain) ?? null
  const headLabel = mainWorktree
    ? (mainWorktree.branch ?? `detached at ${mainWorktree.head?.slice(0, 7)}`)
    : null

  useEffect(() => {
    // Land on something as soon as there is something to land on, including
    // after the selected project is removed.
    if (!selected && list.length > 0) selectProject(list[0].id)
    if (list.length === 0 && projectId) selectProject(null)
  }, [list, selected, projectId, selectProject])

  const openCreateWorktree = (): void => {
    setTrackingRemote(null)
    setCreatingWorktree(true)
  }

  useEffect(() => {
    // The accelerators live in the application menu, which is the only way to
    // get platform-correct modifiers and, on macOS, working copy and paste.
    const unsubscribers = [
      window.arborist.subscribe('app:refresh', () => void queryClient.invalidateQueries()),
      window.arborist.subscribe('app:newWorktree', openCreateWorktree),
      window.arborist.subscribe('app:openSettings', () => setSettingsOpen(true))
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [queryClient])

  const handleFetch = (path: string): void => {
    fetchProject.mutate(path, {
      onError: (error) => toast.error('Fetch failed', { description: error.message })
    })
  }
  const fetchMutate = fetchProject.mutate

  const intervalMinutes = settings.data?.autoFetchIntervalMinutes ?? 0
  const repoPath = selected?.path ?? null
  useEffect(() => {
    // Off by default, and only while the app is focused: polling a corporate
    // remote every few minutes from a window nobody is looking at is a way to
    // get IT emails.
    if (!intervalMinutes || !repoPath) return

    const timer = setInterval(() => {
      if (document.hasFocus()) fetchMutate(repoPath)
    }, intervalMinutes * 60_000)
    return () => clearInterval(timer)
  }, [intervalMinutes, repoPath, fetchMutate])

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
            onNewWorktree={openCreateWorktree}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenProjectSettings={() => setProjectSettingsOpen(true)}
            onPrune={async () => {
              if (!selected) return
              await invoke('worktrees:prune', selected.path)
              await worktrees.refetch()
            }}
            prunableCount={(worktrees.data ?? []).filter((entry) => entry.prunable).length}
            addError={addError}
            onFetch={() => selected && handleFetch(selected.path)}
            fetching={fetchProject.isPending}
            remoteBranches={
              selected && (
                <RemoteBranchList
                  branches={remoteBranches.data ?? []}
                  loading={remoteBranches.isPending}
                  selectedName={selectedRemoteBranchName}
                  onSelect={selectRemoteBranch}
                />
              )
            }
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
        <ResizableHandle className="mx-1 w-0 bg-transparent" />
        <ResizablePanel>
          <main className="h-full rounded-lg border bg-card">
            {!selected && <NoProjects onAddProject={() => void handleAddProject()} />}
            {selected && !worktree && !remoteBranch && (
              <NoWorktreeSelected onNewWorktree={openCreateWorktree} />
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
            {selected && !worktree && remoteBranch && (
              <RemoteBranchDetail
                branch={remoteBranch}
                project={selected}
                onCreateWorktree={() => {
                  setTrackingRemote(remoteBranch)
                  setCreatingWorktree(true)
                }}
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
          onRemove={() => removeProject.mutate(selected.id)}
        />
      )}

      <AutomationConsole target={automation} onClose={() => setAutomation(null)} />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      {selected && (
        <CreateWorktreeDialog
          key={trackingRemote?.name ?? 'new'}
          open={creatingWorktree}
          onOpenChange={(next) => {
            setCreatingWorktree(next)
            if (!next) setTrackingRemote(null)
          }}
          repoPath={selected.path}
          headLabel={headLabel}
          trackRemote={
            trackingRemote && { ref: trackingRemote.name, shortName: trackingRemote.shortName }
          }
          onCreated={async (worktreePath) => {
            const [{ data }] = await Promise.all([worktrees.refetch(), remoteBranches.refetch()])
            selectWorktree(worktreePath)

            // A project with a setup script runs it on the worktree it was
            // written for, without anyone having to remember to.
            const script = await invoke('automation:script', selected.id)
            const created = data?.find((entry) => samePath(entry.path, worktreePath))
            if (script.trim() && created) setAutomation(automationTarget(selected, created))
          }}
        />
      )}
    </div>
  )
}

export default App
