import { Cloud, GitCompareArrows, Hash } from 'lucide-react'
import type { RemoteBranch } from '@shared/domain'
import type { Repository } from '@shared/persisted'
import { branchPositionLabel } from '@shared/branch-position'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/chip'
import { CommitGraph } from '@/components/commit-graph'
import { invoke } from '@/api/client'
import { useRemoteBranchPosition } from '@/api/queries'
import { useRemoteBranchCommit } from '@/state/selection'

/**
 * A remote branch with no local worktree: what the sidebar's Remote
 * Branches section opens onto. One primary action, since the only thing to
 * do here is turn it into a worktree.
 */
export function RemoteBranchDetail({
  branch,
  project,
  onCreateWorktree
}: {
  branch: RemoteBranch
  project: Repository
  onCreateWorktree: () => void
}): React.JSX.Element {
  const [selectedHash, selectCommit] = useRemoteBranchCommit(project.id, branch.name)
  const position = useRemoteBranchPosition(
    project.path,
    branch.name,
    branch.lastCommit?.hash ?? null
  )
  const positionLabel = branchPositionLabel(position.data ?? null)

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6" data-testid="remote-branch-detail">
      <div className="flex items-start gap-3">
        <Cloud className="mt-1.5 size-6 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-heading text-2xl font-semibold">{branch.name}</h1>
          <p className="text-sm text-muted-foreground">No local worktree yet.</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {branch.lastCommit && (
          <Chip
            title="Copy commit hash"
            onClick={() => void invoke('system:copyText', branch.lastCommit!.hash)}
          >
            <Hash className="size-3" />
            {branch.lastCommit.shortHash}
          </Chip>
        )}
        {positionLabel && (
          <Chip testId="branch-position">
            <GitCompareArrows className="size-3" />
            {positionLabel}
          </Chip>
        )}
      </div>

      <Button className="mt-4 self-start" onClick={onCreateWorktree}>
        Create worktree from this branch
      </Button>

      {/* `repoPath` only has to be somewhere inside the repository:
          remote-tracking refs are visible from any worktree that shares it,
          and this branch has no checkout of its own to read them from. */}
      <CommitGraph
        key={`remote-commits:${project.id}:${branch.name}`}
        repoPath={project.path}
        tips={[branch.name]}
        label="Recent Commits"
        selectedHash={selectedHash}
        onSelect={selectCommit}
      />
    </div>
  )
}
