import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { pathToFileURL } from 'url'
import { AppError } from '../../../shared/errors'
import type {
  DeviceCode,
  GitHubAccount,
  GitHubOwner,
  GitHubRepo,
  TokenPoll
} from '../../../shared/github'
import type { GitHubApi } from './github-api'

/**
 * What a screenshot scenario or e2e test says GitHub holds, as the JSON file
 * named by `ARBORIST_FAKE_GITHUB`. The real device flow needs a person at a
 * browser and a real account, so the app can't be driven through it.
 */
export interface FakeGitHubFixture {
  /** Start already signed in. */
  signedIn: boolean
  account: GitHubAccount
  installations: {
    id: number
    owner: GitHubOwner
    repos: { id: number; name: string; private: boolean; description: string | null }[]
  }[]
  /**
   * Where the "remote" repositories live, as bare repositories at
   * `<remoteRoot>/<owner>/<name>.git`: a clone really clones, and a publish
   * really creates one and pushes to it.
   */
  remoteRoot: string
}

export const FAKE_TOKEN = 'fake-github-token'
export const FAKE_USER_CODE = 'WDJB-MJHT'

/**
 * GitHub, as the fixture describes it. The sign-in code is approved the
 * moment Arborist opens the verification page, standing in for the user
 * approving it there.
 */
export class FakeGitHubApi implements GitHubApi {
  readonly webUrl = 'https://github.com'
  readonly #fixture: FakeGitHubFixture
  #approved = false

  constructor(fixture: FakeGitHubFixture) {
    this.#fixture = fixture
  }

  static async load(path: string): Promise<FakeGitHubApi> {
    return new FakeGitHubApi(JSON.parse(await fs.readFile(path, 'utf8')) as FakeGitHubFixture)
  }

  get signedIn(): boolean {
    return this.#fixture.signedIn
  }

  approve(): void {
    this.#approved = true
  }

  async requestDeviceCode(): Promise<DeviceCode & { deviceCode: string }> {
    this.#approved = false
    return {
      deviceCode: 'fake-device-code',
      userCode: FAKE_USER_CODE,
      verificationUri: `${this.webUrl}/login/device`,
      expiresIn: 900,
      interval: 0
    }
  }

  async pollDeviceToken(): Promise<TokenPoll> {
    return this.#approved ? { kind: 'token', token: FAKE_TOKEN } : { kind: 'pending' }
  }

  async refreshToken(): Promise<TokenPoll> {
    return { kind: 'token', token: FAKE_TOKEN }
  }

  async account(): Promise<GitHubAccount> {
    return this.#fixture.account
  }

  async installations(): Promise<{ id: number; owner: GitHubOwner }[]> {
    return this.#fixture.installations.map(({ id, owner }) => ({ id, owner }))
  }

  async installationRepos(_token: string, installationId: number): Promise<GitHubRepo[]> {
    const installation = this.#fixture.installations.find((entry) => entry.id === installationId)
    return (installation?.repos ?? []).map((repo) =>
      this.#repo(installation!.owner.login, repo.id, repo.name, repo.private, repo.description)
    )
  }

  async createRepo(
    _token: string,
    owner: { login: string },
    repo: { name: string; description: string; private: boolean }
  ): Promise<GitHubRepo> {
    const path = join(this.#fixture.remoteRoot, owner.login, `${repo.name}.git`)
    if (await fs.stat(path).catch(() => null)) {
      throw new AppError('GitHub: name already exists on this account', 'github-request-failed')
    }
    await promisify(execFile)('git', ['init', '--bare', '--quiet', path])
    return this.#repo(owner.login, 9000, repo.name, repo.private, repo.description || null)
  }

  #repo(
    owner: string,
    id: number,
    name: string,
    isPrivate: boolean,
    description: string | null
  ): GitHubRepo {
    const url = pathToFileURL(join(this.#fixture.remoteRoot, owner, `${name}.git`)).href
    return {
      id,
      fullName: `${owner}/${name}`,
      owner,
      name,
      private: isPrivate,
      description,
      cloneUrl: url,
      sshUrl: url,
      htmlUrl: `${this.webUrl}/${owner}/${name}`
    }
  }
}
