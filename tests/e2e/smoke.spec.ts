import { mkdtemp, mkdir, readFile, rm, realpath } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { GitFixture } from '../integration/fixtures/git-fixture'

// Requires a prior `electron-vite build` (the pretest:e2e script handles it):
// launching `.` resolves package.json "main" -> out/main/index.js.
async function launch(root: string, pickFolder: string): Promise<ElectronApplication> {
  const userDataDir = join(root, 'user-data')
  await mkdir(userDataDir, { recursive: true })
  return electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    // The folder picker is a native dialog Playwright cannot drive, so the
    // app is told what the user would have chosen.
    env: { ...process.env, ARBORIST_PICK_FOLDER: pickFolder }
  })
}

async function addProject(app: ElectronApplication): Promise<void> {
  const window = await app.firstWindow()
  await window.getByTestId('project-switcher').click()
  await window.getByRole('menuitem', { name: 'Add project…' }).click()
}

test('adds a git repository as a project', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arborist-e2e-')))
  const fixture = new GitFixture(join(root, 'fixture'), 'Arborist')
  await fixture.init()

  const app = await launch(root, fixture.repoPath)
  const window = await app.firstWindow()

  await expect(window.getByTestId('no-projects')).toBeVisible()
  await addProject(app)

  await expect(window.getByTestId('project-detail')).toBeVisible()
  await expect(window.getByRole('heading', { name: 'Arborist' })).toBeVisible()
  await expect(window.getByText(fixture.repoPath)).toBeVisible()

  await app.close()
  await rm(root, { recursive: true, force: true })
})

test('refuses a folder that is not a git repository', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arborist-e2e-')))
  const plainFolder = join(root, 'not-a-repo')
  await mkdir(plainFolder, { recursive: true })

  const app = await launch(root, plainFolder)
  const window = await app.firstWindow()

  await addProject(app)

  await expect(window.getByTestId('add-project-error')).toContainText('not a git repository')
  await expect(window.getByTestId('no-projects')).toBeVisible()

  await app.close()
  await rm(root, { recursive: true, force: true })
})

test('keeps a worktree note across a relaunch', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arborist-e2e-')))
  const fixture = new GitFixture(join(root, 'fixture'), 'Arborist')
  await fixture.init()
  await fixture.addWorktree('feature-x', { branch: 'feature/x' })

  const first = await launch(root, fixture.repoPath)
  const window = await first.firstWindow()
  await addProject(first)
  await window.getByRole('button', { name: /feature\/x/ }).click()
  await window.getByTestId('notes-editor').fill('Rebase before review.')
  // The editor debounces and the store debounces again, so wait for the note
  // to actually reach disk rather than for the keystroke to land.
  await expect
    .poll(async () =>
      readFile(join(root, 'user-data', 'arborist-data.json'), 'utf8').catch(() => '')
    )
    .toContain('Rebase before review.')
  await first.close()

  const second = await launch(root, fixture.repoPath)
  const reopened = await second.firstWindow()
  await reopened.getByRole('button', { name: /feature\/x/ }).click()
  await expect(reopened.getByTestId('notes-editor')).toHaveValue('Rebase before review.')

  await second.close()
  await rm(root, { recursive: true, force: true })
})
