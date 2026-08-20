/**
 * Real git repositories in a temp directory, for the integration suite.
 *
 * These run on macOS and Windows CI, which makes them the main cross-platform
 * regression net: a parser that only breaks on Windows paths should fail here
 * rather than in a bug report.
 *
 * The "remote" is a bare clone reached by file URL, so upstream, fetch and
 * remote-deletion behaviour are all testable with no network.
 */
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Deliberately shells out to git rather than going through the app's own
 * executor: the screenshot runner builds fixtures too, and it runs the
 * TypeScript with Node's type stripping, which cannot follow the extensionless
 * imports the bundled app uses. There is no parsing here, so nothing is
 * duplicated by keeping it separate.
 */
function runGit(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...env },
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`git ${args.join(' ')} failed: ${stderr || error.message}`))
        else resolve(stdout)
      }
    )
  })
}

export interface WorktreeOptions {
  /** Branch to create for the worktree. Omit for a detached checkout. */
  branch?: string
  /** Commit-ish to start from. Defaults to the current HEAD. */
  startPoint?: string
  detach?: boolean
}

/**
 * A fixed base date for every fixture commit. Commit hashes are a function of
 * their timestamps, so pinning these makes both the hashes and the dates the
 * UI renders identical from one run to the next — which is what lets a
 * screenshot of a fixture be compared at all.
 */
const BASE_COMMIT_TIME = Date.parse('2026-01-05T09:00:00Z')
const COMMIT_INTERVAL_MS = 60_000

export class GitFixture {
  readonly root: string
  readonly repoPath: string
  readonly remotePath: string
  #elsewhere: string | null = null
  #commitCount = 0

  constructor(root: string, projectName = 'project') {
    this.root = root
    this.repoPath = join(root, projectName)
    this.remotePath = join(root, 'remote.git')
  }

  git(args: string[], cwd: string = this.repoPath): Promise<string> {
    return runGit(args, cwd)
  }

  /** Writes files (paths relative to `cwd`) and commits them. Returns the sha. */
  async commit(
    message: string,
    files: Record<string, string> = {},
    cwd: string = this.repoPath
  ): Promise<string> {
    for (const [relative, contents] of Object.entries(files)) {
      await fs.writeFile(join(cwd, relative), contents, 'utf8')
    }
    await this.git(['add', '--all'], cwd)
    const when = new Date(BASE_COMMIT_TIME + this.#commitCount++ * COMMIT_INTERVAL_MS).toISOString()
    await runGit(['commit', '--message', message, '--allow-empty'], cwd, {
      GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_DATE: when
    })
    return (await this.git(['rev-parse', 'HEAD'], cwd)).trim()
  }

  /** Adds a worktree in a sibling folder and returns its path. */
  async addWorktree(name: string, options: WorktreeOptions = {}): Promise<string> {
    const path = join(this.root, name)
    const args = ['worktree', 'add']
    if (options.detach) args.push('--detach')
    else if (options.branch) args.push('-b', options.branch)
    args.push(path)
    if (options.startPoint) args.push(options.startPoint)
    await this.git(args)
    return path
  }

  /**
   * Commits to a branch through a second clone, so the change arrives the way
   * a colleague's push would: present on the remote, unknown until a fetch.
   */
  async commitFromElsewhere(branch: string, message: string): Promise<void> {
    const elsewhere = await this.#elsewhereClone()
    await this.git(['fetch', 'origin'], elsewhere)
    const branches = await this.git(
      ['branch', '--remotes', '--list', `origin/${branch}`],
      elsewhere
    )
    if (branches.trim()) {
      await this.git(['checkout', '-B', branch, `origin/${branch}`], elsewhere)
    } else {
      await this.git(['checkout', '-B', branch], elsewhere)
    }
    await this.commit(message, { [`${branch.replace(/\//g, '-')}.txt`]: message }, elsewhere)
    await this.git(['push', 'origin', branch], elsewhere)
  }

  async deleteRemoteBranch(branch: string): Promise<void> {
    await this.git(['push', 'origin', '--delete', branch])
  }

  async #elsewhereClone(): Promise<string> {
    if (this.#elsewhere) return this.#elsewhere
    const path = join(this.root, 'elsewhere')
    await runGit(['clone', this.remotePath, path], this.root)
    await this.#configure(path)
    this.#elsewhere = path
    return path
  }

  async #configure(cwd: string): Promise<void> {
    // Set locally, because a CI runner has no global git identity and every
    // commit below would otherwise fail.
    await this.git(['config', 'user.name', 'Arborist Fixture'], cwd)
    await this.git(['config', 'user.email', 'fixture@example.invalid'], cwd)
    await this.git(['config', 'commit.gpgsign', 'false'], cwd)
  }

  async init(): Promise<void> {
    await fs.mkdir(this.repoPath, { recursive: true })
    await this.git(['init', '--initial-branch=main'])
    await this.#configure(this.repoPath)
    await this.commit('Initial commit', { 'README.md': '# fixture\n' })

    await runGit(['clone', '--bare', this.repoPath, this.remotePath], this.root)
    await this.git(['remote', 'add', 'origin', this.remotePath])
    await this.git(['fetch', 'origin'])
    await this.git(['branch', '--set-upstream-to=origin/main', 'main'])
  }

  async cleanup(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true, maxRetries: 3 })
  }
}

/** A repository with one commit, a bare file-URL remote, and main tracking it. */
export async function makeFixtureRepo(): Promise<GitFixture> {
  // realpath because macOS hands out /var/folders/... paths that are really
  // /private/var/..., and git reports the resolved one: without this, every
  // comparison against a fixture path fails on a Mac and nowhere else.
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'arborist-fixture-')))
  const fixture = new GitFixture(root)
  await fixture.init()
  return fixture
}

export interface BadgeMatrix {
  fixture: GitFixture
  paths: {
    main: string
    aheadBehind: string
    dirty: string
    noUpstream: string
    remoteDeleted: string
    locked: string
    prunable: string
    detached: string
  }
}

/**
 * Every state a worktree badge can show, in one repository: the fixture the
 * refresh pipeline and the sidebar are checked against.
 */
export async function makeBadgeMatrix(): Promise<BadgeMatrix> {
  // realpath because macOS hands out /var/folders/... paths that are really
  // /private/var/..., and git reports the resolved one: without this, every
  // comparison against a fixture path fails on a Mac and nowhere else.
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'arborist-fixture-')))
  return makeBadgeMatrixIn(root)
}

/** The same matrix, in a directory the caller already has. */
export async function makeBadgeMatrixIn(
  root: string,
  projectName = 'project'
): Promise<BadgeMatrix> {
  const fixture = new GitFixture(root, projectName)
  await fixture.init()
  const git = fixture.git.bind(fixture)

  // Clean, tracking, ahead 2 / behind 1.
  const aheadBehind = await fixture.addWorktree('ahead-behind', { branch: 'feature/ahead-behind' })
  await git(['push', '--set-upstream', 'origin', 'feature/ahead-behind'], aheadBehind)
  await fixture.commit('Ahead one', { 'a.txt': 'a' }, aheadBehind)
  await fixture.commit('Ahead two', { 'b.txt': 'b' }, aheadBehind)
  await fixture.commitFromElsewhere('feature/ahead-behind', 'Behind one')
  await git(['fetch', 'origin'], aheadBehind)

  // Uncommitted changes.
  const dirty = await fixture.addWorktree('dirty', { branch: 'feature/dirty' })
  await fs.writeFile(join(dirty, 'README.md'), '# edited but not committed\n', 'utf8')

  // A branch that was never pushed.
  const noUpstream = await fixture.addWorktree('no-upstream', { branch: 'feature/no-upstream' })

  // Pushed, tracked, then deleted on the remote.
  const remoteDeleted = await fixture.addWorktree('remote-deleted', {
    branch: 'feature/remote-deleted'
  })
  await git(['push', '--set-upstream', 'origin', 'feature/remote-deleted'], remoteDeleted)
  await fixture.deleteRemoteBranch('feature/remote-deleted')
  await git(['fetch', '--prune', 'origin'], remoteDeleted)

  const locked = await fixture.addWorktree('locked', { branch: 'feature/locked' })
  await git(['worktree', 'lock', '--reason', 'on an external drive', locked])

  // Prunable: git still lists the entry, but the directory is gone.
  const prunable = await fixture.addWorktree('prunable', { branch: 'feature/prunable' })
  await fs.rm(prunable, { recursive: true, force: true, maxRetries: 3 })

  const head = (await git(['rev-parse', 'HEAD'])).trim()
  const detached = await fixture.addWorktree('detached', { detach: true, startPoint: head })

  return {
    fixture,
    paths: {
      main: fixture.repoPath,
      aheadBehind,
      dirty,
      noUpstream,
      remoteDeleted,
      locked,
      prunable,
      detached
    }
  }
}
