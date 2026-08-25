import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult
} from '@tanstack/react-query'
import type {
  BranchInfo,
  CommitFileStat,
  CommitLogEntry,
  RemoteBranch,
  StashEntry,
  WorkingTreeChanges,
  Worktree
} from '@shared/domain'
import type { DiffRequest, FileDiff } from '@shared/diff'
import type { PresetCatalogue, ResolvedPreset } from '@shared/presets'
import type { ProjectSettings, Repository, Settings } from '@shared/persisted'
import { invoke } from '@/api/client'

const COMMIT_PAGE_SIZE = 20

export const queryKeys = {
  projects: ['projects'] as const,
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
  fileDiff: (request: DiffRequest | null) => ['file-diff', request] as const,
  commitDraft: (repositoryId: string, worktreePath: string) =>
    ['commit-draft', repositoryId, worktreePath] as const,
  hasIdentity: (worktreePath: string) => ['has-identity', worktreePath] as const,
  remoteBranches: (repoPath: string) => ['remote-branches', repoPath] as const,
  localBranches: (repoPath: string) => ['local-branches', repoPath] as const,
  stashes: (worktreePath: string) => ['stashes', worktreePath] as const
}

export function useProjects(): ReturnType<typeof useQuery<Repository[]>> {
  return useQuery({ queryKey: queryKeys.projects, queryFn: () => invoke('projects:list') })
}

export function useAddProject(): UseMutationResult<Repository, Error, string> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (path: string) => invoke('projects:add', path),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.projects })
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
 * Fetches a repository's remotes, then invalidates everything a fetch can
 * change: ahead/behind counts and remote-deleted flags live on the worktree
 * list, and new or vanished remote branches live on the remote-branches list.
 */
export function useFetch(): UseMutationResult<void, Error, string> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (repoPath: string) => invoke('repos:fetch', repoPath),
    onSuccess: (_result, repoPath) => {
      client.invalidateQueries({ queryKey: queryKeys.worktrees(repoPath) })
      client.invalidateQueries({ queryKey: queryKeys.remoteBranches(repoPath) })
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

export function useLocalBranches(
  repoPath: string | null
): ReturnType<typeof useQuery<BranchInfo[]>> {
  return useQuery({
    queryKey: queryKeys.localBranches(repoPath ?? ''),
    queryFn: () => invoke('branches:list', repoPath!),
    enabled: repoPath !== null
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
