import { Tabs, TabsContent, TabsList, TabsTrigger as UiTabsTrigger } from '@/components/ui/tabs'

/**
 * The shadcn tab trigger, minus the focus ring a mouse click started leaving
 * behind with radix-ui 1.8.
 *
 * `@radix-ui/react-tabs` 1.2 calls `focus()` on the trigger from its own
 * mousedown handler, for browsers that don't focus a button on click. Chromium
 * treats focus moved by script as `:focus-visible` whenever the element it
 * moved from was, and a dialog's FocusScope puts focus there from script when
 * it opens. So clicking a tab in Settings, or anywhere after a dialog had
 * closed, drew the keyboard ring around it.
 *
 * Focusing it first with `focusVisible: false` settles the question: radix's
 * own `focus()` is then a no-op on an element that already has focus. This
 * runs before radix's handler, and only for the clicks radix itself acts on.
 * Arrow keys still move focus through radix's roving focus, ring included.
 *
 * Lives outside `components/ui/` because that directory is the shadcn CLI's
 * to overwrite.
 */
function TabsTrigger({
  onMouseDown,
  ...props
}: React.ComponentProps<typeof UiTabsTrigger>): React.JSX.Element {
  return (
    <UiTabsTrigger
      {...props}
      onMouseDown={(event) => {
        onMouseDown?.(event)
        if (!event.defaultPrevented && !props.disabled && event.button === 0 && !event.ctrlKey) {
          event.currentTarget.focus({ focusVisible: false })
        }
      }}
    />
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
