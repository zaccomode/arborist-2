/** A small pill of metadata, on the worktree and remote-branch detail panes. */
export function Chip({
  children,
  onClick,
  title,
  testId
}: {
  children: React.ReactNode
  onClick?: () => void
  title?: string
  testId?: string
}): React.JSX.Element {
  const className =
    'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground'
  if (!onClick) {
    return (
      <span className={className} data-testid={testId}>
        {children}
      </span>
    )
  }
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      data-testid={testId}
      className={`${className} hover:bg-accent`}
    >
      {children}
    </button>
  )
}
