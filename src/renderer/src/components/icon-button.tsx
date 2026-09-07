import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * A button whose whole content is an icon, named by a tooltip (#84).
 *
 * `label` is both the accessible name and the tooltip text, deliberately:
 * two ways of saying what a control does that could drift apart is one way
 * too many, and a tooltip that says something the screen reader does not is
 * the version nobody notices is wrong.
 *
 * Every icon-only button in the app goes through this or through
 * `IconTooltip`, with one exception: a "more" menu — the three vertical dots
 * — which is a convention that needs no gloss, and whose menu says what is
 * in it the moment it opens.
 *
 * A disabled button receives no pointer events, so its tooltip does not
 * open. That is Radix's behaviour rather than a choice made here, and it
 * costs nothing worth working around: a control that cannot be used has
 * nothing to explain yet.
 */
export function IconButton({
  label,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }): React.JSX.Element {
  return (
    <IconTooltip label={label}>
      <Button aria-label={label} {...props} />
    </IconTooltip>
  )
}

/**
 * The tooltip alone, for an icon button that is already wrapped in something
 * else's trigger — a `DropdownMenuTrigger`, say. `IconButton` cannot serve
 * that case: `asChild` clones a single DOM child, and what `IconButton`
 * returns is a tooltip root rather than an element to clone.
 *
 * The child still needs its own `aria-label`, since this only supplies the
 * visible half.
 */
export function IconTooltip({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
