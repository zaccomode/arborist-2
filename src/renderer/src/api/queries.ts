import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult
} from '@tanstack/react-query'
import type { CommitLogEntry, Worktree } from '@shared/domain'
import type { PresetCatalogue, ResolvedPreset } from '@shared/presets'
import type { Repository, Settings } from '@shared/persisted'
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
  commits: (repoPath: string, ref: string) => ['commits', repoPath, ref] as const
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
 * list.
 */
export function useFetch(): UseMutationResult<void, Error, string> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (repoPath: string) => invoke('repos:fetch', repoPath),
    onSuccess: (_result, repoPath) =>
      client.invalidateQueries({ queryKey: queryKeys.worktrees(repoPath) })
  })
}

export function useWorktrees(repoPath: string | null): ReturnType<typeof useQuery<Worktree[]>> {
  return useQuery({
    queryKey: queryKeys.worktrees(repoPath ?? ''),
    queryFn: () => invoke('worktrees:list', repoPath!),
    enabled: repoPath !== null
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

/**
 * Recent commits on `ref`, 20 at a time. `repoPath`/`ref` are nullable so a
 * caller with nothing selected yet can call this unconditionally rather than
 * branching around the hook.
 */
export function useCommitLog(
  repoPath: string | null,
  ref: string | null
): ReturnType<typeof useInfiniteQuery<CommitLogEntry[]>> {
  return useInfiniteQuery({
    queryKey: queryKeys.commits(repoPath ?? '', ref ?? ''),
    queryFn: ({ pageParam }) =>
      invoke('commits:recent', repoPath!, ref!, COMMIT_PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === COMMIT_PAGE_SIZE ? pages.flat().length : undefined,
    enabled: repoPath !== null && ref !== null
  })
}
