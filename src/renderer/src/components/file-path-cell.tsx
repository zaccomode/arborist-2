import { splitDisplayPath } from '@shared/working-tree'

/**
 * The filename-plus-dimmed-directory cell every file-row list shares: the
 * Working Tree tab's rows and the commit inspector's file list alike. Those
 * two lists otherwise stay separate on purpose — one has checkboxes and a
 * context menu, the other has neither — so this is the row *primitive* they
 * share, not the row itself.
 *
 * The directory concatenates first: `shrink-0` on the filename keeps it at
 * its natural width, so only the path gives up space as the row narrows.
 * `truncate` on the filename is a last-resort fallback for when the row
 * can't fit it even with the path fully collapsed.
 */
export function FilePathCell({ path }: { path: string }): React.JSX.Element {
  const { name, dir } = splitDisplayPath(path)
  return (
    <>
      <span className="shrink-0 truncate">{name}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{dir}</span>
    </>
  )
}
