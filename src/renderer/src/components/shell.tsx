import { useEffect, useRef, useState } from 'react'
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
 * Panel widths aren't persisted across sessions here — v4 has no
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
  const currentMainWidth = useRef(700)
  const lastAbsoluteMainWidth = useRef<number | null>(null)
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH)
  const hasInspector = inspector !== null

  useEffect(() => {
    if (!hasInspector) return
    const target = lastAbsoluteMainWidth.current ?? currentMainWidth.current
    mainPanelRef.current?.resize(target)
    // Only the transition into having an inspector needs correcting — while
    // it stays open, ordinary dragging should not be fought.
  }, [hasInspector])

  return (
    <ResizablePanelGroup orientation="horizontal">
      {/* Numeric sizes are pixels: the concept's sidebar is about 260 wide. */}
      <ResizablePanel
        id="sidebar"
        defaultSize={sidebarWidth}
        minSize={200}
        maxSize={420}
        groupResizeBehavior="preserve-pixel-size"
        onResize={onSidebarResize}
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
          <ResizableHandle className="mx-1 w-0 bg-transparent" withHandle />
          <ResizablePanel
            id="inspector"
            defaultSize={inspectorWidth}
            minSize={INSPECTOR_MIN_WIDTH}
            onResize={(size) => setInspectorWidth(size.inPixels)}
          >
            <div className="h-full rounded-lg border bg-card">{inspector}</div>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  )
}
