import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult
} from '@tanstack/react-query'
import type { Worktree } from '@shared/domain'
import type { Repository } from '@shared/persisted'
import { invoke } from '@/api/client'

export const queryKeys = {
  projects: ['projects'] as const,
  worktrees: (repoPath: string) => ['worktrees', repoPath] as const
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

export function useWorktrees(repoPath: string | null): ReturnType<typeof useQuery<Worktree[]>> {
  return useQuery({
    queryKey: queryKeys.worktrees(repoPath ?? ''),
    queryFn: () => invoke('worktrees:list', repoPath!),
    enabled: repoPath !== null
  })
}
