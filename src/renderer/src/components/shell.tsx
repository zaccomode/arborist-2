import { useEffect, useRef } from 'react'
import type { PanelImperativeHandle } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'

const DEFAULT_INSPECTOR_WIDTH = 480
const INSPECTOR_MIN_WIDTH = 320
const MAIN_MIN_WIDTH = 360

/**
 * The three-panel layout: sidebar, worktree/remote-branch detail, and an
 * optional inspector. Only the panel count changes width behaviour, per the
 * concept: the right-most panel always scales with the window, and every
 * panel to its left holds an absolute pixel width. With no inspector, that
 * makes the main panel the scaling one (today's behaviour, unchanged); with
 * one open, the main panel switches to an absolute width — snapped back to
 * whatever it was the last time an inspector was open, via `resize()` on its
 * imperative handle, since it never unmounts and so never re-reads a
 * `defaultSize` of its own.
 *
 * The sidebar keeps the width the user last dragged it to (#177). Opening
 * an inspector can squeeze it below that, since the main panel and the
 * inspector have minimum widths of their own, so closing one `resize()`s it
 * back rather than leaving the freed space to react-resizable-panels, which
 * hands it to the sidebar unevenly (up to its `maxSize` on a second close).
 * Only a drag (`isUserInteraction`) counts as the user choosing a width, and
 * only a drag is reported through `onSidebarResize` to be saved, so neither
 * the squeeze nor anything else the library does to the layout is mistaken
 * for one.
 *
 * Panel widths other than the sidebar's aren't persisted across sessions here — v4 has no
 * `autoSaveId`, only `defaultLayout` plus `onLayoutChanged`, and wiring that
 * up is a deliberate follow-up (v3 Phase 4, #46).
 */
export function Shell({
  sidebarWidth,
  onSidebarResize,
  sidebar,
  main,
  inspector
}: {
  sidebarWidth: number
  onSidebarResize: (size: { inPixels: number }) => void
  sidebar: React.ReactNode
  main: React.ReactNode
  inspector: React.ReactNode | null
}): React.JSX.Element {
  const mainPanelRef = useRef<PanelImperativeHandle>(null)
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null)
  const chosenSidebarWidth = useRef(sidebarWidth)
  const hadInspector = useRef(false)
  // Set when the inspector closes, and acted on once the group has laid
  // itself out without it: resizing straight from the effect is undone by
  // the group's own redistribution, which lands after it.
  const restoreSidebar = useRef(false)
  const currentMainWidth = useRef(700)
  const lastAbsoluteMainWidth = useRef<number | null>(null)
  // A ref, not state: feeding a dragged panel's own live width back into its
  // `defaultSize` on every render fights react-resizable-panels' internal
  // drag tracking, and the handle stops moving a couple of pixels into the
  // gesture. `defaultSize` only needs the constant initial value.
  const inspectorWidth = useRef(DEFAULT_INSPECTOR_WIDTH)
  const hasInspector = inspector !== null

  useEffect(() => {
    const closed = hadInspector.current && !hasInspector
    hadInspector.current = hasInspector
    if (closed) restoreSidebar.current = true
    if (!hasInspector) return
    const target = lastAbsoluteMainWidth.current ?? currentMainWidth.current
    mainPanelRef.current?.resize(target)
    // Only the transition into having an inspector needs correcting — while
    // it stays open, ordinary dragging should not be fought.
  }, [hasInspector])

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      onLayoutChanged={(layout, meta) => {
        if (restoreSidebar.current && !('inspector' in layout)) {
          restoreSidebar.current = false
          sidebarPanelRef.current?.resize(chosenSidebarWidth.current)
        }
        if (!meta.isUserInteraction) return
        const size = sidebarPanelRef.current?.getSize()
        if (!size || size.inPixels === chosenSidebarWidth.current) return
        chosenSidebarWidth.current = size.inPixels
        onSidebarResize(size)
      }}
    >
      {/* Numeric sizes are pixels: the concept's sidebar is about 260 wide. */}
      <ResizablePanel
        id="sidebar"
        panelRef={sidebarPanelRef}
        defaultSize={sidebarWidth}
        minSize={200}
        maxSize={420}
        groupResizeBehavior="preserve-pixel-size"
      >
        {sidebar}
      </ResizablePanel>
      <ResizableHandle className="mx-1 w-0 bg-transparent" />
      <ResizablePanel
        id="main"
        panelRef={mainPanelRef}
        minSize={MAIN_MIN_WIDTH}
        groupResizeBehavior={hasInspector ? 'preserve-pixel-size' : 'preserve-relative-size'}
        onResize={(size) => {
          currentMainWidth.current = size.inPixels
          if (hasInspector) lastAbsoluteMainWidth.current = size.inPixels
        }}
      >
        <main className="h-full rounded-lg border bg-card">{main}</main>
      </ResizablePanel>
      {inspector && (
        <>
          <ResizableHandle className="mx-1 w-0 bg-transparent" />
          <ResizablePanel
            id="inspector"
            defaultSize={DEFAULT_INSPECTOR_WIDTH}
            minSize={INSPECTOR_MIN_WIDTH}
            onResize={(size) => {
              inspectorWidth.current = size.inPixels
            }}
          >
            <div className="h-full rounded-lg border bg-card">{inspector}</div>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  )
}
