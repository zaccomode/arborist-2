import { promises as fs } from 'fs'
import { join } from 'path'
import { AppError } from '../../../shared/errors'
import {
  cloneUrlFor,
  gitAuthEnv,
  installUrl,
  nextPollInterval,
  repoNameFor,
  sortOwners,
  sortRepos,
  type CloneProtocol,
  type DeviceCode,
  type GitHubAccount,
  type GitHubOwner,
  type GitHubPage,
  type GitHubRepo,
  type GitHubStatus,
  type PublishOptions,
  type PublishResult
} from '../../../shared/github'
import type { Repository } from '../../../shared/persisted'
import type { GitRunner } from '../git/git-runner'
import { CLONE_TIMEOUT_MS, FETCH_TIMEOUT_MS, gitEnv } from '../git/git-executor'
import type { Store } from '../persistence/store'
import type { ProjectService } from '../projects'
import { SIGNED_OUT_CODE, type GitHubApi } from './github-api'
import type { TokenStore } from './token-store'

/**
 * GitHub's own minimum is five seconds, so this floor only ever matters to
 * the scenarios' fake, which asks for none.
 */
const MIN_POLL_MS = 100

interface SignInSession {
  deviceCode: string
  verificationUri: string
  expiresAt: number
  interval: number
  cancelled: boolean
  wake: (() => void) | null
}

export interface GitHubServiceDeps {
  api: GitHubApi
  tokens: TokenStore
  git: GitRunner
  store: Store
  projects: ProjectService
  /** Reads a project's remote, to refuse publishing one that already has one. */
  remoteUrl: (repoPath: string) => Promise<string | null>
  openExternal: (url: string) => Promise<void>
}

/**
 * Signs in to GitHub with the device flow, and clones from and publishes to
 * it (#150). The token never leaves the main process: the renderer asks for
 * an account, a repository list or an action, and gets back only the result.
 */
export class GitHubService {
  readonly #deps: GitHubServiceDeps
  #account: GitHubAccount | null = null
  #session: SignInSession | null = null
  /** The last listing, by id, so a clone request names a repository rather than a URL. */
  #repos = new Map<number, GitHubRepo>()

  constructor(deps: GitHubServiceDeps) {
    this.#deps = deps
  }

  async status(): Promise<GitHubStatus> {
    const remembers = this.#deps.tokens.remembers
    const token = await this.#deps.tokens.read()
    if (!token) return { account: null, remembers }
    if (!this.#account) {
      this.#account = await this.#withToken((value) => this.#deps.api.account(value)).catch(
        (error: unknown) => {
          if ((error as AppError).code === SIGNED_OUT_CODE) return null
          throw error
        }
      )
    }
    return { account: this.#account, remembers }
  }

  /** Asks GitHub for a code for the user to approve. Replaces any sign-in already waiting. */
  async startSignIn(): Promise<DeviceCode> {
    this.cancelSignIn()
    const code = await this.#deps.api.requestDeviceCode()
    this.#session = {
      deviceCode: code.deviceCode,
      verificationUri: code.verificationUri,
      expiresAt: Date.now() + code.expiresIn * 1000,
      interval: code.interval,
      cancelled: false,
      wake: null
    }
    return {
      userCode: code.userCode,
      verificationUri: code.verificationUri,
      expiresIn: code.expiresIn,
      interval: code.interval
    }
  }

  /**
   * Polls until the code from `startSignIn` is approved, denied or expires,
   * at the interval GitHub asked for. Resolves with the account it signed in
   * as; rejects with `github-sign-in-cancelled` if `cancelSignIn` stops it.
   */
  async finishSignIn(): Promise<GitHubAccount> {
    const session = this.#session
    if (!session) throw new AppError('There is no sign-in waiting.', 'github-no-sign-in')

    for (;;) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.max(session.interval * 1000, MIN_POLL_MS))
        session.wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
      session.wake = null
      if (session.cancelled) {
        throw new AppError('Sign-in cancelled.', 'github-sign-in-cancelled')
      }
      if (Date.now() > session.expiresAt) {
        this.#session = null
        throw new AppError(
          'The sign-in code expired before it was approved. Start again for a new one.',
          'github-sign-in-failed'
        )
      }

      const poll = await this.#deps.api.pollDeviceToken(session.deviceCode)
      if (session.cancelled) {
        throw new AppError('Sign-in cancelled.', 'github-sign-in-cancelled')
      }
      if (poll.kind === 'token') {
        this.#session = null
        const account = await this.#deps.api.account(poll.token)
        await this.#deps.tokens.write(poll.token)
        this.#account = account
        this.#repos.clear()
        return account
      }
      if (poll.kind === 'failed') {
        this.#session = null
        throw new AppError(poll.message, 'github-sign-in-failed')
      }
      session.interval = nextPollInterval(session.interval, poll)
    }
  }

  cancelSignIn(): void {
    const session = this.#session
    if (!session) return
    session.cancelled = true
    session.wake?.()
    this.#session = null
  }

  /**
   * Opens a GitHub page in the browser. Main picks the URL, so the renderer
   * can send the browser to these two pages and nowhere else.
   */
  async openPage(page: GitHubPage): Promise<void> {
    if (page === 'verification') {
      const uri = this.#session?.verificationUri
      if (!uri) throw new AppError('There is no sign-in waiting.', 'github-no-sign-in')
      await this.#deps.openExternal(uri)
      return
    }
    await this.#deps.openExternal(installUrl(this.#deps.api.webUrl))
  }

  async signOut(): Promise<void> {
    this.cancelSignIn()
    this.#account = null
    this.#repos.clear()
    await this.#deps.tokens.clear()
  }

  /** Every repository the app can reach for this user, across every installation. */
  async repos(): Promise<GitHubRepo[]> {
    const repos = await this.#withToken(async (token) => {
      const installations = await this.#deps.api.installations(token)
      const lists = await Promise.all(
        installations.map((entry) => this.#deps.api.installationRepos(token, entry.id))
      )
      return sortRepos(lists.flat())
    })
    this.#repos = new Map(repos.map((repo) => [repo.id, repo]))
    return repos
  }

  /** Where a project can be published: the accounts and organisations the app is installed on. */
  async owners(): Promise<GitHubOwner[]> {
    const { account } = await this.status()
    const installations = await this.#withToken((token) => this.#deps.api.installations(token))
    return sortOwners(
      installations.map((entry) => entry.owner),
      account?.login ?? null
    )
  }

  /**
   * Clones a repository from the last `repos()` listing into
   * `<parentFolder>/<name>` and adds it as a project. The folder is
   * remembered for next time.
   */
  async clone(repoId: number, protocol: CloneProtocol, parentFolder: string): Promise<Repository> {
    const repo = this.#repos.get(repoId)
    if (!repo) {
      throw new AppError(
        'That repository is no longer listed. Refresh and try again.',
        'github-repo-unknown'
      )
    }
    const destination = join(parentFolder, repo.name)
    const entries = await fs.readdir(destination).catch(() => null)
    if (entries && entries.length > 0) {
      throw new AppError(
        `${destination} already exists and isn't empty. Choose another folder.`,
        'clone-destination-exists'
      )
    }

    const url = cloneUrlFor(repo, protocol)
    const result = await this.#git(['clone', '--', url, destination], url, CLONE_TIMEOUT_MS)
    if (result.exitCode !== 0) {
      throw new AppError(
        `The clone failed: ${gitFailure(result.stderr, protocol)}`,
        'git-command-failed'
      )
    }

    await this.#deps.store.update((data) => {
      data.settings.lastCloneFolder = parentFolder
    })
    return this.#deps.projects.add(destination)
  }

  /**
   * Creates a repository on GitHub, adds it to the project as `origin`, and
   * pushes the chosen branches with `--set-upstream`. A push that fails after
   * the repository was created says so, since the remote is in place by then
   * and the branches can be pushed the usual way.
   */
  async publish(projectId: string, options: PublishOptions): Promise<PublishResult> {
    const project = this.#deps.store.data.repositories.find((repo) => repo.id === projectId)
    if (!project) throw new AppError('That project is no longer in Arborist.', 'project-missing')
    if (await this.#deps.remoteUrl(project.path)) {
      throw new AppError(
        `${project.name} already has a remote, so it is already published somewhere.`,
        'publish-has-remote'
      )
    }
    const name = repoNameFor(options.name)
    if (!name) throw new AppError('Choose a name for the repository.', 'publish-invalid-name')

    const { account } = await this.status()
    if (!account) throw new AppError('Sign in to GitHub to publish.', SIGNED_OUT_CODE)
    const personal = options.owner.toLowerCase() === account.login.toLowerCase()

    const created = await this.#withToken((token) =>
      this.#deps.api.createRepo(
        token,
        { login: options.owner, personal },
        { name, description: options.description.trim(), private: options.private }
      )
    )

    const url = cloneUrlFor(created, options.protocol)
    await this.#deps.git.runOrThrow(['remote', 'add', 'origin', url], { repoPath: project.path })

    if (options.branches.length > 0) {
      const result = await this.#git(
        ['push', '--set-upstream', 'origin', ...options.branches],
        url,
        FETCH_TIMEOUT_MS,
        project.path
      )
      if (result.exitCode !== 0) {
        throw new AppError(
          `Created ${created.fullName} on GitHub and added it as origin, but the push failed: ${gitFailure(result.stderr, options.protocol)}`,
          'publish-push-failed'
        )
      }
    }
    return { fullName: created.fullName, htmlUrl: created.htmlUrl }
  }

  /** Runs git with the token as an HTTPS header for `url`'s host, if there is one to hand. */
  async #git(
    args: string[],
    url: string,
    timeoutMs: number,
    repoPath?: string
  ): ReturnType<GitRunner['run']> {
    const token = await this.#deps.tokens.read()
    const env = token ? gitAuthEnv(url, token, gitEnv()) : undefined
    return this.#deps.git.run(args, { repoPath, timeoutMs, env })
  }

  /** Runs `call` with the token, forgetting it if GitHub says it is no longer valid. */
  async #withToken<T>(call: (token: string) => Promise<T>): Promise<T> {
    const token = await this.#deps.tokens.read()
    if (!token) throw new AppError('Sign in to GitHub to continue.', SIGNED_OUT_CODE)
    try {
      return await call(token)
    } catch (error) {
      if ((error as AppError).code === SIGNED_OUT_CODE) await this.signOut()
      throw error
    }
  }
}

/** Git's own reason, with a pointer for SSH's usual one. */
function gitFailure(stderr: string, protocol: CloneProtocol): string {
  const reason = stderr.trim() || 'git exited without saying why.'
  const hint =
    protocol === 'ssh' && /permission denied \(publickey\)/i.test(stderr)
      ? ' SSH uses your own keys rather than Arborist’s sign-in: add one to GitHub, or use HTTPS.'
      : ''
  return `${reason}${hint}`
}
