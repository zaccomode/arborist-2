import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult
} from '@tanstack/react-query'
import type {
  BranchPosition,
  LocalBranch,
  CommitFileStat,
  CommitLogEntry,
  RemoteBranch,
  StashEntry,
  WorkingTreeChanges,
  Worktree
} from '@shared/domain'
import type { ConflictState } from '@shared/conflicts'
import type { DiffRequest, FileDiff } from '@shared/diff'
import type { PresetCatalogue, ResolvedPreset } from '@shared/presets'
import type { ProjectSettings, Repository, Settings } from '@shared/persisted'
import type { RemoteLocation } from '@shared/project-groups'
import type { GitHubOwner, GitHubRepo, GitHubStatus } from '@shared/github'
import { fetchCaller, projectHasRemote, type FetchTrigger } from '@shared/sync'
import { invoke } from '@/api/client'

const COMMIT_PAGE_SIZE = 20

export const queryKeys = {
  projects: ['projects'] as const,
  // Under `projects`, so adding or removing one regroups the switcher too.
  projectRemoteLocations: ['projects', 'remote-locations'] as const,
  projectsHasRemote: ['projects', 'has-remote'] as const,
  worktrees: (repoPath: string) => ['worktrees', repoPath] as const,
  note: (repositoryId: string, worktreePath: string | null) =>
    ['note', repositoryId, worktreePath] as const,
  presets: (repoPath: string | null, projectId: string | null) =>
    ['presets', repoPath, projectId] as const,
  presetCatalogue: ['preset-catalogue'] as const,
  settings: ['settings'] as const,
  projectSettings: (projectId: string) => ['project-settings', projectId] as const,
  commits: (repoPath: string, refs: readonly string[]) => ['commits', repoPath, ...refs] as const,
  commit: (repoPath: string, hash: string) => ['commit', repoPath, hash] as const,
  commitFiles: (repoPath: string, hash: string) => ['commit-files', repoPath, hash] as const,
  workingTree: (worktreePath: string) => ['working-tree', worktreePath] as const,
  conflictState: (worktreePath: string) => ['conflict-state', worktreePath] as const,
  fileDiff: (request: DiffRequest | null) => ['file-diff', request] as const,
  commitDraft: (repositoryId: string, worktreePath: string) =>
    ['commit-draft', repositoryId, worktreePath] as const,
  hasIdentity: (worktreePath: string) => ['has-identity', worktreePath] as const,
  remoteBranches: (repoPath: string) => ['remote-branches', repoPath] as const,
  localBranches: (repoPath: string) => ['local-branches', repoPath] as const,
  // Under `localBranches`, so invalidating that prefix-matches this too.
  localBranchDetails: (repoPath: string) => ['local-branches', repoPath, 'details'] as const,
  remoteHead: (repoPath: string) => ['remote-head', repoPath] as const,
  // Under `remoteBranches`, so whatever refreshes that list (a fetch, the
  // watcher) prefix-matches this too. `tip` is the branch's commit, so a new
  // commit on it is a new key rather than a stale count.
  remoteBranchPosition: (repoPath: string, ref: string, tip: string | null) =>
    ['remote-branches', repoPath, 'position', ref, tip] as const,
  stashes: (worktreePath: string) => ['stashes', worktreePath] as const,
  // Everything GitHub sits under one prefix, so signing in or out refreshes
  // the account, the repository list and the owners at once.
  github: ['github'] as const,
  githubStatus: ['github', 'status'] as const,
  githubRepos: ['github', 'repos'] as const,
  githubOwners: ['github', 'owners'] as const
}

export function useProjects(): ReturnType<typeof useQuery<Repository[]>> {
  return useQuery({ queryKey: queryKeys.projects, queryFn: () => invoke('projects:list') })
}

/**
 * Where each project is published, for grouping the switcher by owner
 * (#150). Remotes rarely change, and reading them costs a couple of git
 * processes per project (and an `ssh -G` per SSH host), so this stays fresh
 * far longer than the app's default rather than re-reading every project on
 * each window focus (#166).
 */
export const PROJECT_LOCATIONS_STALE_MS = 5 * 60_000

export function useProjectRemoteLocations(): ReturnType<
  typeof useQuery<Record<string, RemoteLocation | null>>
> {
  return useQuery({
    queryKey: queryKeys.projectRemoteLocations,
    queryFn: () => invoke('projects:remoteLocations'),
    staleTime: PROJECT_LOCATIONS_STALE_MS
  })
}

/**
 * Whether each project has a remote at all (#150), for offering to publish
 * the ones without and for sending their push buttons to that offer. Fresh
 * for as long as the locations are, for the same reason.
 */
export function useProjectsHasRemote(): ReturnType<typeof useQuery<Record<string, boolean>>> {
  return useQuery({
    queryKey: queryKeys.projectsHasRemote,
    queryFn: () => invoke('projects:hasRemote'),
    staleTime: PROJECT_LOCATIONS_STALE_MS
  })
}

/**
 * Whether a project has a remote: null until that is known, including for a
 * project added since the answer was read (#175).
 */
export function useProjectHasRemote(projectId: string): boolean | null {
  return projectHasRemote(useProjectsHasRemote().data, projectId)
}

export function useAddProject(): UseMutationResult<Repository, Error, string> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (path: string) => invoke('projects:add', path),
    onSuccess: async () => {
      // Locations first, then the list: the other way round, the new project
      // is listed before its location is known and briefly shows under
      // "Local" (#166). A failed refetch still lets the list refresh.
      await client.invalidateQueries({ queryKey: queryKeys.projectRemoteLocations })
      // Without this a new project with no remote isn't offered "Publish to
      // GitHub" for up to five minutes, and its push fails instead (#175).
      await client.invalidateQueries({ queryKey: queryKeys.projectsHasRemote })
      await client.invalidateQueries({ queryKey: queryKeys.projects, exact: true })
    }
  })
}

/** Who Arborist is signed in to GitHub as (#150). */
export function useGitHubStatus(): ReturnType<typeof useQuery<GitHubStatus>> {
  return useQuery({
    queryKey: queryKeys.githubStatus,
    queryFn: () => invoke('github:status'),
    staleTime: Infinity,
    retry: false
  })
}

/**
 * The repositories a clone can pick from, once signed in. Each read is a
 * request per installation, so it stays fresh for the life of a dialog rather
 * than refetching on every window focus.
 */
export function useGitHubRepos(enabled: boolean): ReturnType<typeof useQuery<GitHubRepo[]>> {
  return useQuery({
    queryKey: queryKeys.githubRepos,
    queryFn: () => invoke('github:repos'),
    enabled,
    staleTime: 60_000,
    retry: false
  })
}

export function useGitHubOwners(enabled: boolean): ReturnType<typeof useQuery<GitHubOwner[]>> {
  return useQuery({
    queryKey: queryKeys.githubOwners,
    queryFn: () => invoke('github:owners'),
    enabled,
    staleTime: 60_000,
    retry: false
  })
}

export function useRemoveProject(): UseMutationResult<void, Error, string> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => invoke('projects:remove', id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.projects })
  })
}

/**
 * A fetch and what started it. The caller it runs as (#185) follows from the
 * trigger through `fetchCaller`, so a call site can't leave it out (#187).
 */
export interface FetchRequest {
  repoPath: string
  trigger: FetchTrigger
}

/**
 * Fetches a repository's remotes, then invalidates everything a fetch can
 * change: ahead/behind counts and remote-deleted flags live on the worktree
 * list, and new or vanished remote branches live on the remote-branches list.
 */
export function useFetch(): UseMutationResult<void, Error, FetchRequest> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ repoPath, trigger }: FetchRequest) =>
      invoke('repos:fetch', repoPath, fetchCaller(trigger)),
    onSuccess: (_result, { repoPath }) => {
      client.invalidateQueries({ queryKey: queryKeys.worktrees(repoPath) })
      client.invalidateQueries({ queryKey: queryKeys.remoteBranches(repoPath) })
      // A fetch moves the remote-tracking refs, so every open commit query on
      // this repository resets to page 0 — see `useCommitLog` on why resetting
      // rather than patching a page is what keeps `--skip` paging safe.
      client.invalidateQueries({ queryKey: ['commits', repoPath] })
    }
  })
}

export function useRemoteBranches(
  repoPath: string | null
): ReturnType<typeof useQuery<RemoteBranch[]>> {
  return useQuery({
    queryKey: queryKeys.remoteBranches(repoPath ?? ''),
    queryFn: () => invoke('branches:remote', repoPath!),
    enabled: repoPath !== null
  })
}

/**
 * Local branches with upstream and tip commit, for the switch-branch picker
 * (#96) and create-worktree's base-ref picker.
 */
export function useLocalBranchDetails(
  repoPath: string | null
): ReturnType<typeof useQuery<LocalBranch[]>> {
  return useQuery({
    queryKey: queryKeys.localBranchDetails(repoPath ?? ''),
    queryFn: () => invoke('branches:localDetails', repoPath!),
    enabled: repoPath !== null
  })
}

/** Where `origin/HEAD` points, for picking out the default branch (#96). */
export function useRemoteHead(repoPath: string | null): ReturnType<typeof useQuery<string | null>> {
  return useQuery({
    queryKey: queryKeys.remoteHead(repoPath ?? ''),
    queryFn: () => invoke('branches:remoteHead', repoPath!),
    enabled: repoPath !== null
  })
}

/**
 * Where a remote branch stands against the default branch (#151), for the
 * pill on its detail pane. Asked for only when a branch is opened, unlike a
 * worktree's, which arrives with the worktree list: a repository can have
 * hundreds of remote branches, and counting each on every refresh would cost
 * far more than the one pill on screen is worth.
 */
export function useRemoteBranchPosition(
  repoPath: string,
  ref: string,
  tip: string | null
): ReturnType<typeof useQuery<BranchPosition | null>> {
  return useQuery({
    queryKey: queryKeys.remoteBranchPosition(repoPath, ref, tip),
    queryFn: () => invoke('branches:position', repoPath, ref)
  })
}

export function useWorktrees(repoPath: string | null): ReturnType<typeof useQuery<Worktree[]>> {
  return useQuery({
    queryKey: queryKeys.worktrees(repoPath ?? ''),
    queryFn: () => invoke('worktrees:list', repoPath!),
    enabled: repoPath !== null
  })
}

/** A worktree's uncommitted changes, for the Working Tree tab. */
export function useWorkingTree(
  worktreePath: string | null
): ReturnType<typeof useQuery<WorkingTreeChanges>> {
  return useQuery({
    queryKey: queryKeys.workingTree(worktreePath ?? ''),
    queryFn: () => invoke('workingTree:get', worktreePath!),
    enabled: worktreePath !== null
  })
}

/**
 * Which operation (if any) has the worktree mid-conflict, for the Conflicts
 * section — fetched whenever the Working Tree tab is open, not only when
 * `u` records are present, since the section stays up (offering Continue)
 * after the last one is resolved but before the operation itself finishes.
 */
export function useConflictState(
  worktreePath: string | null
): ReturnType<typeof useQuery<ConflictState>> {
  return useQuery({
    queryKey: queryKeys.conflictState(worktreePath ?? ''),
    queryFn: () => invoke('conflicts:state', worktreePath!),
    enabled: worktreePath !== null
  })
}

/** The inspector panel's diff, for whichever file or commit is selected. */
export function useFileDiff(request: DiffRequest | null): ReturnType<typeof useQuery<FileDiff>> {
  return useQuery({
    queryKey: queryKeys.fileDiff(request),
    queryFn: () => invoke('diff:get', request!),
    enabled: request !== null
  })
}

/** A worktree's draft commit message. */
export function useCommitDraft(
  repositoryId: string,
  worktreePath: string
): ReturnType<typeof useQuery<string>> {
  return useQuery({
    queryKey: queryKeys.commitDraft(repositoryId, worktreePath),
    queryFn: () => invoke('commitDraft:get', repositoryId, worktreePath),
    refetchOnWindowFocus: false
  })
}

/** A worktree's stashes, newest first, for the Working Tree tab's Stash section. */
export function useStashes(worktreePath: string | null): ReturnType<typeof useQuery<StashEntry[]>> {
  return useQuery({
    queryKey: queryKeys.stashes(worktreePath ?? ''),
    queryFn: () => invoke('stash:list', worktreePath!),
    enabled: worktreePath !== null
  })
}

/** Whether `user.email` resolves for this worktree — a hint, never a block. */
export function useHasIdentity(worktreePath: string): ReturnType<typeof useQuery<boolean>> {
  return useQuery({
    queryKey: queryKeys.hasIdentity(worktreePath),
    queryFn: () => invoke('workingTree:hasIdentity', worktreePath)
  })
}

export function useNote(
  repositoryId: string,
  worktreePath: string | null
): ReturnType<typeof useQuery<string>> {
  return useQuery({
    queryKey: queryKeys.note(repositoryId, worktreePath),
    queryFn: () => invoke('notes:get', repositoryId, worktreePath),
    // Notes only change here, so refetching them on focus would fight
    // whatever the user is typing.
    refetchOnWindowFocus: false
  })
}

export function usePresets(
  repoPath: string | null,
  projectId: string | null
): ReturnType<typeof useQuery<ResolvedPreset[]>> {
  return useQuery({
    queryKey: queryKeys.presets(repoPath, projectId),
    queryFn: () => invoke('presets:list', repoPath, projectId)
  })
}

export function usePresetCatalogue(): ReturnType<typeof useQuery<PresetCatalogue>> {
  return useQuery({
    queryKey: queryKeys.presetCatalogue,
    queryFn: () => invoke('presets:catalogue')
  })
}

export function useSettings(): ReturnType<typeof useQuery<Settings>> {
  return useQuery({ queryKey: queryKeys.settings, queryFn: () => invoke('settings:get') })
}

export function useProjectSettings(
  projectId: string
): ReturnType<typeof useQuery<ProjectSettings>> {
  return useQuery({
    queryKey: queryKeys.projectSettings(projectId),
    queryFn: () => invoke('projectSettings:get', projectId)
  })
}

/**
 * Recent commits on `ref`, 20 at a time. `ref` is a single tip for the
 * Recent Commits panel (a branch, HEAD, or a remote ref), or a `[tip,
 * upstream]` pair for the commit graph — see `commitGraphTips`.
 * `repoPath`/`ref` are nullable so a caller with nothing selected yet can
 * call this unconditionally rather than branching around the hook.
 *
 * `--skip`-based paging (in `commitLog`, main-side) is stable exactly as
 * long as nothing shifts underneath it mid-scroll. Both a mutation
 * (staging, committing, branch switching) and the file watcher invalidate
 * every `['commits', repoPath, ...]` query wholesale rather than patching
 * one page in place — see `App.tsx`'s `worktree:changed` handler — which
 * resets this back to page 0 instead of ever re-fetching a page whose
 * `--skip` offset has become stale. Cursor-based paging isn't needed
 * because of that, not despite it.
 */
export function useCommitLog(
  repoPath: string | null,
  ref: string | readonly string[] | null
): ReturnType<typeof useInfiniteQuery<CommitLogEntry[]>> {
  const refs = ref === null ? null : Array.isArray(ref) ? ref : [ref]
  return useInfiniteQuery({
    queryKey: queryKeys.commits(repoPath ?? '', refs ?? []),
    queryFn: ({ pageParam }) =>
      invoke('commits:recent', repoPath!, [...refs!], COMMIT_PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === COMMIT_PAGE_SIZE ? pages.flat().length : undefined,
    enabled: repoPath !== null && refs !== null && refs.length > 0
  })
}

/** One commit's metadata, for the commit inspector's header. */
export function useCommit(
  repoPath: string | null,
  hash: string | null
): ReturnType<typeof useQuery<CommitLogEntry | null>> {
  return useQuery({
    queryKey: queryKeys.commit(repoPath ?? '', hash ?? ''),
    queryFn: async () => {
      const commits = await invoke('commits:recent', repoPath!, [hash!], 1, 0)
      return commits[0] ?? null
    },
    enabled: repoPath !== null && hash !== null
  })
}

/** One commit's changed files, for the commit inspector's file list. */
export function useCommitFiles(
  repoPath: string | null,
  hash: string | null
): ReturnType<typeof useQuery<CommitFileStat[]>> {
  return useQuery({
    queryKey: queryKeys.commitFiles(repoPath ?? '', hash ?? ''),
    queryFn: () => invoke('commits:files', repoPath!, hash!),
    enabled: repoPath !== null && hash !== null
  })
}
