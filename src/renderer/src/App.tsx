import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { RemoteBranch, Worktree } from '@shared/domain'
import type { Repository } from '@shared/persisted'
import type { DiffRequest } from '@shared/diff'
import { splitDisplayPath, stagingState } from '@shared/working-tree'
import { useQueryClient } from '@tanstack/react-query'
import { Shell } from '@/components/shell'
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
import { DiffPanel } from '@/components/diff-panel'
import {
  queryKeys,
  useAddProject,
  useFetch,
  useProjects,
  useRemoteBranches,
  useRemoveProject,
  useSettings,
  useWorkingTree,
  useWorktrees
} from '@/api/queries'
import { invoke } from '@/api/client'
import { samePath } from '@/lib/paths'
import {
  useSelection,
  useSelectedRemoteBranch,
  useSelectedWorktree,
  useWorktreeInspector
} from '@/state/selection'

/**
 * Matches the strip main/index.ts reserves for the OS's traffic lights or
 * overlay. 38 is macOS's own unified-toolbar height for a hidden titlebar —
 * reserving anything taller leaves the (fixed-position) traffic lights
 * looking stuck near the top of an oversized gap instead of centered in it.
 */
const TITLE_BAR_HEIGHT = 38

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

function App(): React.JSX.Element | null {
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

  const { projectId, selectProject, selectWorktree, selectRemoteBranch, hydrated } = useSelection()
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

  const [inspector, , closeInspector] = useWorktreeInspector(
    selected?.id ?? '',
    worktree?.path ?? ''
  )
  // Only for `origPath`, so a rename's diff keeps rename detection — the
  // Working Tree tab already has this data loaded, and React Query shares
  // the cache rather than firing a second request.
  const inspectorWorkingTree = useWorkingTree(worktree?.path ?? null)
  const inspectorFile =
    inspector?.kind === 'file'
      ? (inspectorWorkingTree.data?.files.find((file) => file.path === inspector.path) ?? null)
      : null
  const diffRequest: DiffRequest | null =
    worktree && inspector?.kind === 'file'
      ? {
          kind: inspector.side === 'untracked' ? 'untracked' : inspector.side,
          worktreePath: worktree.path,
          path: inspector.path,
          origPath: inspectorFile?.origPath ?? null
        }
      : null
  // Whether the diff panel needs a way to switch sides: only relevant for a
  // file with real content on both — a partially-staged `MM` (or an `AM`
  // partially-staged new file), the case `diffSideFor` can only pick one
  // side of. `stagingState`'s `indeterminate` is exactly that condition.
  const diffHasBothSides = inspectorFile ? stagingState(inspectorFile) === 'indeterminate' : false

  useEffect(() => {
    void invoke('selection:get').then((data) => useSelection.getState().hydrate(data))
  }, [])

  useEffect(() => {
    // Land on something as soon as there is something to land on, including
    // after the selected project is removed. Held off until the persisted
    // selection is back, so it doesn't jump to the first project and then
    // immediately back to the remembered one.
    if (!hydrated) return
    if (!selected && list.length > 0) selectProject(list[0].id)
    if (list.length === 0 && projectId) selectProject(null)
  }, [hydrated, list, selected, projectId, selectProject])

  useEffect(() => {
    // Never leave a project on the empty state: land on whatever worktree or
    // remote branch was selected last time, or on the main worktree if
    // nothing was ever selected for it.
    if (!hydrated || !selected || worktrees.isPending) return
    if (selectedWorktree || selectedRemoteBranchName) return
    if (mainWorktree) selectWorktree(mainWorktree.path)
  }, [
    hydrated,
    selected,
    worktrees.isPending,
    mainWorktree,
    selectedWorktree,
    selectedRemoteBranchName,
    selectWorktree
  ])

  const sidebarResizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSidebarResize = (size: { inPixels: number }): void => {
    if (sidebarResizeTimer.current) clearTimeout(sidebarResizeTimer.current)
    sidebarResizeTimer.current = setTimeout(() => {
      void invoke('settings:update', { sidebarWidth: Math.round(size.inPixels) }).then(() =>
        queryClient.invalidateQueries({ queryKey: ['settings'] })
      )
    }, 400)
  }

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

  // The sidebar's persisted width is only meaningful as an initial mount
  // value, so the panel waits for it rather than mounting at the fallback
  // and silently never picking up the saved size. Selection waits on the
  // same gate, so it never flashes an empty state before landing on the
  // remembered project and worktree.
  if (!settings.data || !hydrated) return null

  // Only macOS and Windows get a hidden OS titlebar (see main/index.ts), so
  // only there does the app need to draw its own draggable strip and leave
  // room for the native traffic lights or window-control overlay that floats
  // over it.
  const flushTitleBar = window.arborist.platform !== 'linux'

  return (
    <div
      className="relative h-screen bg-background px-2 pb-2"
      style={{ paddingTop: flushTitleBar ? TITLE_BAR_HEIGHT : 8 }}
    >
      {flushTitleBar && (
        <div
          className="absolute inset-x-0 top-0"
          style={{ height: TITLE_BAR_HEIGHT, WebkitAppRegion: 'drag' } as React.CSSProperties}
        />
      )}
      <Shell
        sidebarWidth={settings.data.sidebarWidth}
        onSidebarResize={handleSidebarResize}
        sidebar={
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
        }
        main={
          <>
            {!selected && <NoProjects onAddProject={() => void handleAddProject()} />}
            {selected && !worktree && !remoteBranch && (
              <NoWorktreeSelected onNewWorktree={openCreateWorktree} />
            )}
            {selected && worktree && (
              <WorktreeDetail
                worktree={worktree}
                project={selected}
                refreshing={worktrees.isFetching}
                onRefresh={() => {
                  void worktrees.refetch()
                  // The working tree only otherwise updates from Arborist's
                  // own mutations, per Phase 5 (#48) — a manual refresh is
                  // this tab's way to pick up a change made outside it,
                  // until the watcher (#50) covers that automatically.
                  void queryClient.invalidateQueries({
                    queryKey: queryKeys.workingTree(worktree.path)
                  })
                }}
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
          </>
        }
        inspector={
          diffRequest && (
            <DiffPanel
              request={diffRequest}
              label={splitDisplayPath(diffRequest.path).name}
              hasBothSides={diffHasBothSides}
              onClose={closeInspector}
            />
          )
        }
      />

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
          projectId={selected.id}
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
