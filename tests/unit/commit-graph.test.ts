import { describe, it, expect } from 'vitest'
import { assignLanes, type GraphCommit } from '../../src/shared/commit-graph'

/** A minimal `GraphCommit` — the tests only ever care about hash and parents. */
function c(hash: string, parents: string[] = []): GraphCommit {
  return { hash, parents }
}

describe('assignLanes', () => {
  it('keeps a straight line in lane 0', () => {
    // Newest first, as `git log` prints it.
    const commits = [c('c3', ['c2']), c('c2', ['c1']), c('c1', [])]

    const rows = assignLanes(commits)

    expect(rows).toEqual([
      {
        commit: commits[0],
        lane: 0,
        laneCount: 1,
        newLane: true,
        edges: [],
        throughLanes: [],
        danglingParents: [],
        overflow: false
      },
      {
        commit: commits[1],
        lane: 0,
        laneCount: 1,
        newLane: false,
        edges: [],
        throughLanes: [],
        danglingParents: [],
        overflow: false
      },
      {
        commit: commits[2],
        lane: 0,
        laneCount: 1,
        newLane: false,
        edges: [],
        throughLanes: [],
        danglingParents: [],
        overflow: false
      }
    ])
  })

  it('forks and rejoins for a simple merge', () => {
    // main: Base -> Main1 -\
    //                        Merge
    // feat: Base -> Feat1 -> Feat2 -/
    const merge = c('merge', ['main1', 'feat2'])
    const main1 = c('main1', ['base'])
    const feat2 = c('feat2', ['feat1'])
    const feat1 = c('feat1', ['base'])
    const base = c('base', [])
    const commits = [merge, main1, feat2, feat1, base]

    const rows = assignLanes(commits)
    const byHash = Object.fromEntries(rows.map((row) => [row.commit.hash, row]))

    // The merge commit opens a second lane for its non-first parent.
    expect(byHash.merge).toMatchObject({
      lane: 0,
      laneCount: 2,
      newLane: true,
      edges: [{ kind: 'parent', lane: 1, dangling: false }],
      throughLanes: []
    })

    // main1 stays in lane 0; feat2's lane (1) is untouched, so it passes through.
    expect(byHash.main1).toMatchObject({ lane: 0, edges: [], throughLanes: [1] })

    // feat2 occupies lane 1, opened by the merge commit; main1's lane (0) passes through.
    expect(byHash.feat2).toMatchObject({ lane: 1, newLane: false, edges: [], throughLanes: [0] })

    expect(byHash.feat1).toMatchObject({ lane: 1, edges: [], throughLanes: [0] })

    // Both lanes converge on `base`: the join clears lane 1 with a merge edge
    // into lane 0, where `base` itself is drawn.
    expect(byHash.base).toMatchObject({
      lane: 0,
      edges: [{ kind: 'merge', lane: 1, dangling: false }],
      throughLanes: []
    })

    // Every row stays within the two lanes this history actually uses.
    for (const row of rows) expect(row.laneCount).toBeLessThanOrEqual(2)
  })

  it('never draws more than maxLanes for an octopus merge, and flags overflow', () => {
    const parents = Array.from({ length: 9 }, (_, i) => `p${i}`)
    const octopus = c('octopus', parents)
    const leaves = parents.map((hash) => c(hash, []))
    const commits = [octopus, ...leaves]

    const rows = assignLanes(commits, { maxLanes: 8 })
    const octopusRow = rows[0]

    expect(octopusRow.overflow).toBe(true)
    expect(octopusRow.laneCount).toBeLessThanOrEqual(8)
    expect(octopusRow.lane).toBeLessThan(8)
    for (const edge of octopusRow.edges) expect(edge.lane).toBeLessThan(8)

    // The 9th parent (index 8, 0-based) is the one that overflows into the
    // last lane alongside whatever else already lives there.
    const lastEdge = octopusRow.edges.at(-1)
    expect(lastEdge).toMatchObject({ kind: 'parent', lane: 7, dangling: false })

    for (const row of rows) expect(row.laneCount).toBeLessThanOrEqual(8)
  })

  it('never renders more than maxLanes even with room to spare, for a lane index right at the boundary', () => {
    // Exactly maxLanes parents (no overflow) versus maxLanes + 1 (overflow),
    // to pin the off-by-one at the boundary itself.
    const eightParents = Array.from({ length: 8 }, (_, i) => `p${i}`)
    const exactly8 = assignLanes([c('m', eightParents), ...eightParents.map((h) => c(h, []))], {
      maxLanes: 8
    })
    expect(exactly8[0].overflow).toBe(false)
    expect(exactly8[0].laneCount).toBe(8)

    const nineParents = Array.from({ length: 9 }, (_, i) => `p${i}`)
    const nine = assignLanes([c('m', nineParents), ...nineParents.map((h) => c(h, []))], {
      maxLanes: 8
    })
    expect(nine[0].overflow).toBe(true)
    expect(nine[0].laneCount).toBe(8)
  })

  it("flags a commit's parent that isn't among the loaded commits as dangling", () => {
    const rows = assignLanes([c('tip', ['not-loaded'])])

    expect(rows).toEqual([
      {
        commit: { hash: 'tip', parents: ['not-loaded'] },
        lane: 0,
        laneCount: 1,
        newLane: true,
        edges: [],
        throughLanes: [],
        danglingParents: ['not-loaded'],
        overflow: false
      }
    ])
  })

  it("flags a merge's second parent as dangling when only the first page is loaded", () => {
    // The merge is the last row of a page; only its first parent is loaded.
    const merge = c('merge', ['main1', 'not-loaded-feat-tip'])
    const main1 = c('main1', [])
    const rows = assignLanes([merge, main1])

    const mergeRow = rows[0]
    expect(mergeRow.danglingParents).toEqual(['not-loaded-feat-tip'])
    expect(mergeRow.edges).toEqual([{ kind: 'parent', lane: 1, dangling: true }])

    // The converse — a parent that *is* loaded, many rows down — needs
    // nothing special: the lane simply stays occupied until the fold
    // reaches it, with no dangling flag anywhere along the way.
    const straightLine = assignLanes([c('tip', ['mid']), c('mid', ['deep']), c('deep', [])])
    for (const row of straightLine) {
      expect(row.danglingParents).toEqual([])
      for (const edge of row.edges) expect(edge.dangling).toBe(false)
    }
  })

  it('handles a root commit — no parents, no edges, nothing dangling', () => {
    const rows = assignLanes([c('root', [])])
    expect(rows).toEqual([
      {
        commit: { hash: 'root', parents: [] },
        lane: 0,
        laneCount: 1,
        newLane: true,
        edges: [],
        throughLanes: [],
        danglingParents: [],
        overflow: false
      }
    ])
  })

  it('returns nothing for an empty commit list', () => {
    expect(assignLanes([])).toEqual([])
  })

  it('marks a second, diverged tip as a new lane rather than a continuation', () => {
    // Two independent roots loaded together — e.g. a branch and an upstream
    // that have never shared history in the visible window.
    const rows = assignLanes([c('tip-a', []), c('tip-b', [])])
    expect(rows[0]).toMatchObject({ lane: 0, newLane: true })
    expect(rows[1]).toMatchObject({ lane: 0, newLane: true })
  })
})
