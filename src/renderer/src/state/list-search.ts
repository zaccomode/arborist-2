import { create } from 'zustand'

/** Which of the sidebar's two lists a search box belongs to. */
export type ListKind = 'worktrees' | 'remote-branches'

interface ListSearchState {
  /**
   * `<list kind>::<project id>` → the query typed into that list's search
   * box. Deliberately never persisted, per #77: a filter is about what you
   * are doing right now, and a saved one that survives a restart is a list
   * that comes back mysteriously short. Keyed by project so switching
   * repositories does not carry one repository's filter onto another's list.
   */
  queries: Record<string, string>
  /**
   * Which search boxes are open. Separate from the query because the box
   * exists before anything is typed into it, and closing it clears the
   * query rather than leaving a filter applied with nothing on screen to
   * say so.
   */
  open: Record<string, boolean>
  setQuery: (key: string, query: string) => void
  setOpen: (key: string, open: boolean) => void
}

function searchKey(kind: ListKind, projectId: string): string {
  return `${kind}::${projectId}`
}

const useListSearch = create<ListSearchState>((set) => ({
  queries: {},
  open: {},
  setQuery: (key, query) => set((state) => ({ queries: { ...state.queries, [key]: query } })),
  setOpen: (key, open) =>
    set((state) => {
      const queries = { ...state.queries }
      // Closing clears: a filter still applied behind a hidden box is a list
      // silently missing rows, which reads as a bug rather than a filter.
      if (!open) delete queries[key]
      return { open: { ...state.open, [key]: open }, queries }
    })
}))

export interface ListSearch {
  open: boolean
  query: string
  setQuery: (query: string) => void
  setOpen: (open: boolean) => void
}

/** One list's search box state, for the lifetime of this app run only. */
export function useListSearchBox(kind: ListKind, projectId: string | null): ListSearch {
  const key = searchKey(kind, projectId ?? '')
  const open = useListSearch((state) => state.open[key] ?? false)
  const query = useListSearch((state) => state.queries[key] ?? '')
  const setQuery = useListSearch((state) => state.setQuery)
  const setOpen = useListSearch((state) => state.setOpen)
  return {
    open,
    query,
    setQuery: (next) => setQuery(key, next),
    setOpen: (next) => setOpen(key, next)
  }
}
