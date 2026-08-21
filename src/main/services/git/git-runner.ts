import { AppError } from '../../../shared/errors'
import { GitLocator } from './git-discovery'
import { execGitAt, type ExecGitOptions, type GitExecResult } from './git-executor'

/**
 * Every git call in the app goes through here, so the binary is discovered
 * once and a missing git produces one typed error rather than a different
 * spawn failure at each call site.
 */
export class GitRunner {
  readonly locator: GitLocator

  constructor(locator: GitLocator = new GitLocator()) {
    this.locator = locator
  }

  async run(args: readonly string[], options: ExecGitOptions = {}): Promise<GitExecResult> {
    const discovery = await this.locator.discover()
    if (!discovery.found || !discovery.path) {
      throw new AppError('Git was not found on this system.', 'git-not-found')
    }
    return execGitAt(discovery.path, args, options)
  }

  /** Runs git and throws on a non-zero exit, for callers with no failure branch. */
  async runOrThrow(args: readonly string[], options: ExecGitOptions = {}): Promise<GitExecResult> {
    const result = await this.run(args, options)
    if (result.exitCode !== 0) {
      throw new AppError(
        result.stderr.trim() || `git ${args.join(' ')} exited with ${result.exitCode}`,
        'git-command-failed'
      )
    }
    return result
  }
}
