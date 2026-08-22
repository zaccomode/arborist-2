import { randomUUID } from 'crypto'
import { basename } from 'path'
import { AppError } from '../../shared/errors'
import type { Repository } from '../../shared/persisted'
import type { Store } from './persistence/store'
import type { GitRunner } from './git/git-runner'
import { normaliseGitPath, samePath } from '../../shared/paths'

/**
 * Projects are repositories the user has added to Arborist. Adding one only
 * records where it is; removing one only forgets it. Nothing here touches the
 * files on disk.
 */
export class ProjectService {
  #store: Store
  #git: GitRunner

  constructor(store: Store, git: GitRunner) {
    this.#store = store
    this.#git = git
  }

  list(): Repository[] {
    return [...this.#store.data.repositories]
  }

  async add(path: string): Promise<Repository> {
    // Ask git what it makes of the folder rather than looking for a .git
    // entry: that also resolves a subdirectory to the repository root, and
    // gets submodules and worktrees right for free.
    const result = await this.#git.run(['rev-parse', '--show-toplevel'], { repoPath: path })
    if (result.exitCode !== 0) {
      throw new AppError(`${path} is not a git repository.`, 'not-a-repository')
    }

    // Through the same normalisation as everything else git prints: on
    // Windows this comes back with forward slashes, and it is the path the
    // detail pane shows and every git call is made against.
    const root = normaliseGitPath(result.stdout.trim())
    // Compared case-insensitively on Windows: the same folder reached through
    // the picker and through a shell can differ only in the case of the drive
    // letter, and adding it twice would give it two independent sets of notes.
    const existing = this.#store.data.repositories.find((repo) => samePath(repo.path, root))
    if (existing) {
      throw new AppError(`${existing.name} is already in Arborist.`, 'project-already-added')
    }

    const repository: Repository = {
      id: randomUUID(),
      path: root,
      name: basename(root),
      addedAt: new Date().toISOString()
    }
    await this.#store.update((data) => {
      data.repositories.push(repository)
    })
    return repository
  }

  /** Forgets the project. The repository itself, and its notes, are untouched. */
  async remove(id: string): Promise<void> {
    await this.#store.update((data) => {
      data.repositories = data.repositories.filter((repo) => repo.id !== id)
    })
  }
}
