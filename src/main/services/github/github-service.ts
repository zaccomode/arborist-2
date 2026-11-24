import { promises as fs } from 'fs'
import { join } from 'path'
import { AppError } from '../../../shared/errors'
import {
  canRefresh,
  cloneUrlFor,
  credentialsFrom,
  gitAuthEnv,
  githubRepoForUrl,
  refreshDue,
  refreshRefused,
  repoAuthEnv,
  installUrl,
  nextPollInterval,
  repoNameFor,
  sortOwners,
  sortRepos,
  type CloneProtocol,
  type DeviceCode,
  type GitHubAccount,
  type GitHubCredentials,
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
import type { RemoteCaller } from '../git/git-service'
import { GITHUB_REQUEST_TIMEOUT_MS, SIGNED_OUT_CODE, type GitHubApi } from './github-api'
import type { TokenStore } from './token-store'

/**
 * GitHub's own minimum is five seconds, so this floor only ever matters to
 * the scenarios' fake, which asks for none.
 */
const MIN_POLL_MS = 100

/**
 * How long the list of repositories the app can reach is trusted for when
 * deciding whether a fetch, pull or push may carry the token. Installing the
 * app on another repository shows up within this long; publishing one clears
 * it at once.
 */
const GRANTED_REPOS_TTL_MS = 5 * 60_000

/**
 * How long a failed listing is remembered (#179), so a background fetch for
 * every project doesn't each list again while GitHub can't be reached.
 */
const GRANTED_REPOS_FAILURE_TTL_MS = 30_000

/**
 * How long a background fetch waits for the token and the listing before
 * going ahead without the token (#179). Both carry on and are used next
 * time. A pull or push the user started waits longer: see `networkEnv`.
 */
const GRANTED_REPOS_WAIT_MS = 3_000

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
  /** Every URL git fetches from or pushes to in a project, after `insteadOf`. */
  remoteUrls: (repoPath: string) => Promise<string[]>
  openExternal: (url: string) => Promise<void>
  /**
   * Called when the service signs out on its own, because GitHub refused
   * the sign-in (#178), so the renderer stops showing the account. Not
   * called for `signOut()`, whose caller already knows.
   */
  onSignedOut?: () => void
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
  /** One refresh at a time: GitHub invalidates a refresh token the moment it is used. */
  #refreshing: Promise<GitHubCredentials | null> | null = null
  /** Lower-cased `owner/name` of every repository the app can reach, and when that was read. */
  #granted: { names: Set<string>; at: number } | null = null
  #grantedLoading: Promise<Set<string>> | null = null
  /** When the last listing for `#grantedRepos` failed, to wait before trying again. */
  #grantedFailedAt: number | null = null
  /**
   * Bumped by every sign-out and sign-in (#178). Anything that awaited
   * GitHub compares it before touching the store, so a refresh that lands
   * after the user signed out, or signed in as someone else, is dropped
   * rather than undoing that.
   */
  #generation = 0

  constructor(deps: GitHubServiceDeps) {
    this.#deps = deps
  }

  async status(): Promise<GitHubStatus> {
    const remembers = this.#deps.tokens.remembers
    if (!(await this.#deps.tokens.read())) return { account: null, remembers }
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
        // Kept before anything else can fail (#175): the device code is spent
        // by now, so a token dropped here means approving on GitHub again.
        this.#generation++
        await this.#deps.tokens.write(credentialsFrom(poll, Date.now()))
        this.#forgetListings()
        let account: GitHubAccount
        try {
          account = await this.#withToken((token) => this.#deps.api.account(token))
        } catch (error) {
          if ((error as AppError).code === SIGNED_OUT_CODE) throw error
          // Signed in all the same; `status()` reads the account again later.
          throw new AppError(
            `Signed in to GitHub, but Arborist couldn't read your account: ${(error as Error).message}`,
            'github-account-failed'
          )
        }
        this.#account = account
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
    this.#generation++
    this.cancelSignIn()
    this.#forgetListings()
    await this.#deps.tokens.clear()
  }

  /** Every repository the app can reach for this user, across every installation. */
  async repos(): Promise<GitHubRepo[]> {
    const generation = this.#generation
    const repos = await this.#withToken(async (token) => {
      const installations = await this.#deps.api.installations(token)
      const lists = await Promise.all(
        installations.map((entry) => this.#deps.api.installationRepos(token, entry.id))
      )
      return sortRepos(lists.flat())
    })
    // Another account's listing, or one from before signing out, isn't
    // this sign-in's to keep (#178).
    if (generation !== this.#generation) return repos
    this.#repos = new Map(repos.map((repo) => [repo.id, repo]))
    this.#grantedFailedAt = null
    this.#granted = {
      names: new Set(repos.map((repo) => repo.fullName.toLowerCase())),
      at: Date.now()
    }
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

    // The new repository isn't in the last listing, and its first push after
    // this one should carry the token like any other.
    this.#granted = null
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

  /**
   * Extra environment for a fetch, pull or push in `repoPath` (#174): the
   * token as an HTTPS header, scoped to each of the project's remote URLs
   * that points at a repository the app can reach. Without it, a project
   * cloned over HTTPS through Arborist could be cloned but not pulled from
   * or pushed to by anyone who has no credential helper for github.com.
   *
   * A remote the app can't reach gets nothing, rather than a header GitHub
   * would refuse in place of the user's own working credentials. So does
   * every remote when signed out, and any failure here: the git operation
   * then runs exactly as it would have before sign-in existed. A remote the
   * app can reach with less than the user's own credentials allow is
   * covered by `GitService`, which retries without this on a refusal (#179).
   *
   * How long it waits on GitHub depends on `caller`. A listing that is out
   * of date is always used while a new one loads.
   *
   * - `background` (a fetch, #179): never waits long. Whatever isn't to hand
   *   within `GRANTED_REPOS_WAIT_MS` (a first listing, a token refresh) is
   *   left to finish for next time, and the fetch goes ahead without the
   *   token. A listing that just failed isn't tried again for a while.
   * - `user` (a pull or push the user started, #181): waits for a listing,
   *   each of whose requests is bounded by the API's own timeout, and lists
   *   again even if the last listing failed, since going ahead without the
   *   token is what fails the push for someone with no credential helper. A
   *   token refresh is waited on for `GITHUB_REQUEST_TIMEOUT_MS` only, and
   *   left running past that rather than abandoned (#182).
   */
  async networkEnv(
    repoPath: string,
    caller: RemoteCaller = 'background'
  ): Promise<Record<string, string> | undefined> {
    const env = this.#networkEnv(repoPath, caller)
    return caller === 'user'
      ? env.catch(() => undefined)
      : within(env, GRANTED_REPOS_WAIT_MS, undefined)
  }

  async #networkEnv(
    repoPath: string,
    caller: RemoteCaller
  ): Promise<Record<string, string> | undefined> {
    if (!(await this.#deps.tokens.read())) return undefined
    const webUrl = this.#deps.api.webUrl
    const candidates = (await this.#deps.remoteUrls(repoPath)).filter(
      (url) => githubRepoForUrl(url, webUrl) !== null
    )
    if (candidates.length === 0) return undefined
    const token =
      caller === 'user'
        ? await within(this.#token(), GITHUB_REQUEST_TIMEOUT_MS, null)
        : await this.#token()
    if (!token) return undefined
    const granted = await this.#grantedRepos(caller)
    const urls = candidates.filter((url) => granted.has(githubRepoForUrl(url, webUrl)!))
    return urls.length > 0 ? repoAuthEnv(urls, token, gitEnv()) : undefined
  }

  /** Runs git with the token as an HTTPS header for `url`'s host, if there is one to hand. */
  async #git(
    args: string[],
    url: string,
    timeoutMs: number,
    repoPath?: string
  ): ReturnType<GitRunner['run']> {
    const token = await this.#token().catch(() => null)
    const env = token ? gitAuthEnv(url, token, gitEnv()) : undefined
    return this.#deps.git.run(args, { repoPath, timeoutMs, env })
  }

  /**
   * Runs `call` with the token. If GitHub refuses it, an expiring token is
   * refreshed and the call tried once more (#174); a token that can't be
   * refreshed, or is refused again, is forgotten.
   */
  async #withToken<T>(call: (token: string) => Promise<T>): Promise<T> {
    const generation = this.#generation
    const token = await this.#token()
    if (!token) throw new AppError('Sign in to GitHub to continue.', SIGNED_OUT_CODE)
    try {
      return await call(token)
    } catch (error) {
      if ((error as AppError).code !== SIGNED_OUT_CODE) throw error
      // Rejects if GitHub can't be reached to refresh (#178), which says
      // nothing about whether the sign-in is still good, so keeps it.
      const retry = await this.#tokenAfterRefusal(token)
      if (!retry) {
        await this.#signedOutBy(generation)
        throw error
      }
      try {
        return await call(retry)
      } catch (again) {
        if ((again as AppError).code === SIGNED_OUT_CODE) await this.#signedOutBy(generation)
        throw again
      }
    }
  }

  /**
   * Signs out because GitHub refused the sign-in that was current at
   * `generation`, unless the user has signed out or in since (#178), and
   * tells the renderer.
   */
  async #signedOutBy(generation: number): Promise<void> {
    if (generation !== this.#generation) return
    await this.signOut()
    this.#deps.onSignedOut?.()
  }

  /**
   * The access token to use now, refreshed first if it has expired or is
   * about to. Null when signed out, including when the refresh token itself
   * has expired or GitHub refuses it. Rejects when GitHub can't be reached
   * to refresh, or answers with anything but a token or a refusal, and
   * keeps the sign-in for next time (#178).
   */
  async #token(): Promise<string | null> {
    const credentials = await this.#deps.tokens.read()
    if (!credentials) return null
    if (!refreshDue(credentials, Date.now())) return credentials.accessToken
    return (await this.#refresh(credentials))?.accessToken ?? null
  }

  /**
   * A token to retry with after GitHub refused `refused`, or null to give up.
   * Rejects, like `#token`, when the refresh couldn't get an answer.
   */
  async #tokenAfterRefusal(refused: string): Promise<string | null> {
    const credentials = await this.#deps.tokens.read()
    if (!credentials) return null
    // Another call refreshed while this one was in flight.
    if (credentials.accessToken !== refused) return credentials.accessToken
    if (!canRefresh(credentials, Date.now())) return null
    return (await this.#refresh(credentials))?.accessToken ?? null
  }

  #refresh(credentials: GitHubCredentials): Promise<GitHubCredentials | null> {
    this.#refreshing ??= this.#runRefresh(credentials).finally(() => {
      this.#refreshing = null
    })
    return this.#refreshing
  }

  /**
   * Swaps `credentials` for a new pair. Signs out only when GitHub refuses
   * the refresh token, or it has expired (#178); any other failure rejects
   * and leaves the stored pair alone, to try again later. If the user signed
   * out or in while GitHub was answering, the answer is dropped and the
   * store left as they left it: null when signed out, or the new sign-in.
   */
  async #runRefresh(credentials: GitHubCredentials): Promise<GitHubCredentials | null> {
    const generation = this.#generation
    if (!canRefresh(credentials, Date.now())) {
      await this.#signedOutBy(generation)
      return null
    }
    const poll = await this.#deps.api.refreshToken(credentials.refreshToken!)
    if (generation !== this.#generation) return this.#deps.tokens.read()
    if (poll.kind === 'token') {
      const next = credentialsFrom(poll, Date.now())
      // The store runs one operation at a time (#183), so a sign-out or
      // sign-in that starts while this is still being written takes effect
      // after it, rather than being undone by it.
      await this.#deps.tokens.write(next)
      if (generation !== this.#generation) return this.#deps.tokens.read()
      return next
    }
    if (refreshRefused(poll)) {
      await this.#signedOutBy(generation)
      return null
    }
    throw new AppError(
      poll.kind === 'failed'
        ? `GitHub couldn't renew the sign-in: ${poll.message}`
        : "GitHub couldn't renew the sign-in.",
      'github-request-failed'
    )
  }

  /**
   * The repositories the app can reach, from a recent listing or a new one.
   *
   * A listing past `GRANTED_REPOS_TTL_MS` is still returned while a new one
   * loads. With none to hand, this waits for one; `networkEnv` bounds that
   * wait for a background fetch. A listing that failed isn't tried again for
   * `GRANTED_REPOS_FAILURE_TTL_MS` (#179), except for a `user` caller, which
   * would otherwise go without the token (#181).
   *
   * A listing belongs to the sign-in it started under (#183): once the user
   * signs out or in, `#forgetListings` stops anyone new waiting on it, and
   * its failure no longer holds the next sign-in's listings back.
   */
  #grantedRepos(caller: RemoteCaller): Promise<Set<string>> {
    const now = Date.now()
    const granted = this.#granted
    if (granted && now - granted.at < GRANTED_REPOS_TTL_MS) return Promise.resolve(granted.names)
    const failedRecently =
      this.#grantedFailedAt !== null && now - this.#grantedFailedAt < GRANTED_REPOS_FAILURE_TTL_MS
    if (!this.#grantedLoading && (!failedRecently || caller === 'user')) {
      const generation = this.#generation
      const current = (): boolean => generation === this.#generation
      const loading: Promise<Set<string>> = this.repos()
        .then(() => (current() ? this.#granted?.names : undefined) ?? new Set<string>())
        .catch(() => {
          if (!current()) return new Set<string>()
          this.#grantedFailedAt = Date.now()
          return granted?.names ?? new Set<string>()
        })
        .finally(() => {
          if (this.#grantedLoading === loading) this.#grantedLoading = null
        })
      this.#grantedLoading = loading
    }
    if (granted) return Promise.resolve(granted.names)
    return this.#grantedLoading ?? Promise.resolve(new Set<string>())
  }

  #forgetListings(): void {
    this.#account = null
    this.#repos.clear()
    this.#granted = null
    this.#grantedLoading = null
    this.#grantedFailedAt = null
  }
}

/**
 * `promise`, or `fallback` if it hasn't settled within `ms` or rejects. The
 * promise itself carries on: a token refresh left behind still lands in the
 * store for next time.
 */
async function within<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const giveUp = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  try {
    return await Promise.race([promise.catch(() => fallback), giveUp])
  } finally {
    clearTimeout(timer)
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
