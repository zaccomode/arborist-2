import { ArrowDown, ArrowUp, CircleAlert, Lock, Unlink } from 'lucide-react'
import type { Worktree } from '@shared/domain'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

function Badge({
  label,
  children,
  className
}: {
  label: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`flex items-center gap-0.5 text-[11px] leading-none text-muted-foreground ${className ?? ''}`}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The concept design doesn't show these, so they are deliberately quiet: a
 * dot and a couple of counts in the row's own muted style, with the words
 * left to the detail pane.
 */
export function WorktreeBadges({ worktree }: { worktree: Worktree }): React.JSX.Element | null {
  const status = worktree.status

  return (
    <span className="flex shrink-0 items-center gap-1.5" data-testid="worktree-badges">
      {worktree.prunable && (
        <Badge label="This worktree's folder is missing" className="text-destructive">
          <CircleAlert className="size-3" />
        </Badge>
      )}
      {worktree.locked && (
        <Badge label={worktree.lockReason ? `Locked: ${worktree.lockReason}` : 'Locked'}>
          <Lock className="size-3" />
        </Badge>
      )}
      {status?.gone && (
        <Badge label="Its upstream branch was deleted on the remote">
          <Unlink className="size-3" />
        </Badge>
      )}
      {status?.dirty && (
        <Badge label="Uncommitted changes">
          <span className="size-1.5 rounded-full bg-amber-500" />
        </Badge>
      )}
      {(status?.ahead ?? 0) > 0 && (
        <Badge label={`${status?.ahead} ahead of ${status?.upstream}`}>
          <ArrowUp className="size-3" />
          {status?.ahead}
        </Badge>
      )}
      {(status?.behind ?? 0) > 0 && (
        <Badge label={`${status?.behind} behind ${status?.upstream}`}>
          <ArrowDown className="size-3" />
          {status?.behind}
        </Badge>
      )}
    </span>
  )
}
