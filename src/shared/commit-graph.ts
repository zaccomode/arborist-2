/**
 * Lane assignment for the commit graph — pure, no git, no DOM, no React.
 *
 * A classic active-lanes fold. `lanes` (private to `assignLanes`, never
 * exposed) holds, per lane index, the hash that lane is waiting to see next,
 * or null once free. Commits must arrive in topo order (`git log
 * --topo-order`, a parent always printed after its children) for the fold to
 * mean anything: date order alone can interleave a parent ahead of its own
 * child, which would make "the lane already waiting for it" nonsensical.
 */

export interface GraphCommit {
  hash: string
  /** First-parent first, as `%P` prints them — a merge row has more than one. */
  parents: readonly string[]
}

export type GraphEdgeKind = 'parent' | 'merge'

export interface GraphEdge {
  kind: GraphEdgeKind
  /** Display lane index (already clamped to `maxLanes`) the edge runs to. */
  lane: number
  /**
   * Only meaningful for a `parent` edge: that parent isn't among the loaded
   * commits (the tail end of a page not yet fetched), so the renderer fades
   * a short stub instead of drawing a line to a row that doesn't exist. A
   * `merge` edge is never dangling — a join only ever resolves to a commit
   * this fold has already reached, since it's `commits` itself that's being
   * walked.
   */
  dangling: boolean
}

export interface GraphRow<C extends GraphCommit = GraphCommit> {
  commit: C
  /** Display lane index this commit's own dot sits in. */
  lane: number
  /** Lanes in use across the commits loaded so far — the SVG rail's width, in lane units. */
  laneCount: number
  /**
   * True when nothing above was waiting for this commit — the very first
   * row of the whole graph, or a second, diverged tip (an unmerged upstream,
   * say) with no incoming line to draw into this row.
   */
  newLane: boolean
  /**
   * Lines leaving this row: a `parent` edge for every parent after the
   * first (which inherits `lane` instead and needs no edge of its own — the
   * trunk just continues straight down), and a `merge` edge for every other
   * lane this commit's hash resolved — a fork rejoining.
   */
  edges: GraphEdge[]
  /**
   * Lanes with an unbroken line passing through this row, untouched by this
   * commit — not its own lane, not named by an edge above. The renderer
   * draws these as plain verticals so a lane a fork is still waiting on
   * doesn't visually break while unrelated commits are drawn in between.
   */
  throughLanes: number[]
  /**
   * This commit's own parents that aren't present in `commits` — the tail
   * end of a page not yet loaded. `useInfiniteQuery` pages 20 at a time, so
   * every last row of a page ends here until "Load more" resolves it. The
   * *first* parent dangling this way is `parents[0]`, checked against this
   * list directly rather than carried on the row a second time; a `parent`
   * edge (parents after the first) carries its own `dangling` flag instead.
   */
  danglingParents: string[]
  /** This row touched a lane beyond `maxLanes` and got folded into the last one. */
  overflow: boolean
}

/**
 * Lanes whose line reaches this row's bottom edge and so has to keep going
 * below it: every lane merely passing through, this row's own lane (unless
 * its first parent is dangling, which fades to a short stub instead of
 * reaching the edge), and any `parent` edge that isn't itself dangling for
 * the same reason. A `merge` edge never qualifies — it only ever runs from
 * the top of the row down to the dot, nowhere near the bottom edge.
 *
 * Pulled out of the renderer rather than left as JSX-adjacent logic: the
 * renderer draws each row as a fixed-height SVG *head* plus, only for these
 * lanes, a flexible *tail* that stretches to cover however much taller a
 * wrapped commit subject makes the row — so this is exactly the set that
 * decides whether a row gets a tail at all, and where it draws.
 */
export function tailLanes<C extends GraphCommit>(row: GraphRow<C>): number[] {
  const lanes = new Set(row.throughLanes)
  const hasFirstParent = row.commit.parents.length > 0
  const firstParentDangling = hasFirstParent && row.danglingParents.includes(row.commit.parents[0])
  if (hasFirstParent && !firstParentDangling) lanes.add(row.lane)
  for (const edge of row.edges) {
    if (edge.kind === 'parent' && !edge.dangling) lanes.add(edge.lane)
  }
  return [...lanes]
}

const DEFAULT_MAX_LANES = 8

/**
 * Folds a topo-ordered, newest-first commit list into lanes: which column
 * each commit's dot sits in, and the edges connecting it to the row above
 * and below.
 *
 * For each commit: take the lane already waiting for it (some earlier row
 * named it as a parent), or the first free slot, or push a new one. The
 * first parent inherits that same lane. Every other parent takes a free
 * lane of its own and gets a `parent` edge. Any *other* lane still waiting
 * for this commit's hash is a join — a fork converging back — so it's
 * cleared and gets a `merge` edge into this commit's lane. Trailing nulls
 * are popped off `lanes` after each row so `laneCount` stays small rather
 * than growing forever with lanes nothing since has reused.
 *
 * `maxLanes` (8 by default) clamps how far right a lane can be *displayed*:
 * bookkeeping still tracks lanes past it internally (so a join far beyond
 * the visible rail still resolves correctly), but its dot and every edge
 * touching it render folded into the last lane, with `overflow: true` on
 * every row involved — a pathological octopus merge doesn't get to render
 * sixty columns.
 */
export function assignLanes<C extends GraphCommit>(
  commits: readonly C[],
  options: { maxLanes?: number } = {}
): GraphRow<C>[] {
  const maxLanes = options.maxLanes ?? DEFAULT_MAX_LANES
  const known = new Set(commits.map((commit) => commit.hash))
  const lanes: (string | null)[] = []
  const rows: GraphRow<C>[] = []

  const takeFreeLane = (): number => {
    const index = lanes.indexOf(null)
    if (index !== -1) return index
    lanes.push(null)
    return lanes.length - 1
  }

  const display = (rawLane: number): { lane: number; overflow: boolean } =>
    rawLane < maxLanes ? { lane: rawLane, overflow: false } : { lane: maxLanes - 1, overflow: true }

  for (const commit of commits) {
    const existingLane = lanes.indexOf(commit.hash)
    const newLane = existingLane === -1
    const laneIndex = newLane ? takeFreeLane() : existingLane

    const ownDisplay = display(laneIndex)
    let overflow = ownDisplay.overflow
    const edges: GraphEdge[] = []

    // A join: any *other* lane also waiting for this hash converges here.
    for (let i = 0; i < lanes.length; i++) {
      if (i === laneIndex || lanes[i] !== commit.hash) continue
      lanes[i] = null
      const at = display(i)
      if (at.overflow) overflow = true
      edges.push({ kind: 'merge', lane: at.lane, dangling: false })
    }

    // Everything else still waiting, untouched by this commit, passes through.
    const throughLanes: number[] = []
    const seenThrough = new Set<number>()
    for (let i = 0; i < lanes.length; i++) {
      if (i === laneIndex || lanes[i] === null) continue
      const at = display(i)
      if (at.overflow) overflow = true
      if (seenThrough.has(at.lane)) continue
      seenThrough.add(at.lane)
      throughLanes.push(at.lane)
    }

    const [firstParent, ...restParents] = commit.parents
    const danglingParents: string[] = []

    if (firstParent !== undefined) {
      lanes[laneIndex] = firstParent
      if (!known.has(firstParent)) danglingParents.push(firstParent)
    } else {
      lanes[laneIndex] = null
    }

    for (const parent of restParents) {
      const parentLane = takeFreeLane()
      lanes[parentLane] = parent
      const at = display(parentLane)
      if (at.overflow) overflow = true
      const dangling = !known.has(parent)
      if (dangling) danglingParents.push(parent)
      edges.push({ kind: 'parent', lane: at.lane, dangling })
    }

    const laneCountThisRow = lanes.length

    // Compact trailing nulls now that this row is fully resolved, so
    // `laneCount` stays small for whatever row comes next.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    rows.push({
      commit,
      lane: ownDisplay.lane,
      laneCount: Math.min(laneCountThisRow, maxLanes),
      newLane,
      edges,
      throughLanes,
      danglingParents,
      overflow
    })
  }

  return rows
}
