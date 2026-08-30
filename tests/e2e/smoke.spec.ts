import { mkdtemp, mkdir, readdir, readFile, rm, realpath, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { GitFixture } from '../integration/fixtures/git-fixture'

// Requires a prior `electron-vite build` (the pretest:e2e script handles it):
// launching `.` resolves package.json "main" -> out/main/index.js.
async function launch(
  root: string,
  pickFolder: string,
  extraEnv: Record<string, string> = {}
): Promise<ElectronApplication> {
  const userDataDir = join(root, 'user-data')
  await mkdir(userDataDir, { recursive: true })
  return electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    // The folder picker is a native dialog Playwright cannot drive, so the
    // app is told what the user would have chosen.
    env: { ...process.env, ARBORIST_PICK_FOLDER: pickFolder, ...extraEnv }
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

  // Lands on the main worktree rather than an empty state, since nothing was
  // ever selected for this project before.
  await expect(window.getByTestId('worktree-detail')).toBeVisible()
  await expect(window.getByTestId('project-switcher')).toContainText('Arborist')

  // The path it actually opened, which the project's own settings carry.
  await window.getByRole('button', { name: 'Project settings' }).click()
  await expect(window.getByTestId('project-settings-dialog')).toContainText(fixture.repoPath)

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

test('remembers the selected worktree and sidebar width across a relaunch', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arborist-e2e-')))
  const fixture = new GitFixture(join(root, 'fixture'), 'Arborist')
  await fixture.init()
  await fixture.addWorktree('feature-x', { branch: 'feature/x' })

  const first = await launch(root, fixture.repoPath)
  const window = await first.firstWindow()
  await addProject(first)
  // Lands on main by default; switching away is what there is to remember.
  await window.getByRole('button', { name: /feature\/x/ }).click()
  await window.getByTestId('worktree-detail').filter({ hasText: 'feature/x' }).waitFor()

  const handle = window.locator('[data-slot="resizable-handle"]')
  const box = await handle.boundingBox()
  if (!box) throw new Error('resizable handle not found')
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await window.mouse.down()
  await window.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 5 })
  await window.mouse.up()

  const dataFile = join(root, 'user-data', 'arborist-data.json')
  await expect
    .poll(async () => JSON.parse(await readFile(dataFile, 'utf8')).selection?.projectId, {
      timeout: 5000
    })
    .toBeTruthy()
  await expect
    .poll(async () => JSON.parse(await readFile(dataFile, 'utf8')).settings?.sidebarWidth, {
      timeout: 5000
    })
    .toBeGreaterThan(260)
  await first.close()

  const second = await launch(root, fixture.repoPath)
  const reopened = await second.firstWindow()
  // No "Add project…" click: the project, the worktree selected within it,
  // and the sidebar width all come back without being asked for again.
  await expect(reopened.getByTestId('worktree-detail')).toContainText('feature/x')
  const sidebar = await reopened.locator('[data-panel]').first().boundingBox()
  expect(sidebar?.width).toBeGreaterThan(260)

  await second.close()
  await rm(root, { recursive: true, force: true })
})

test('runs a shell preset in a console that shows it failing', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arborist-e2e-')))
  const fixture = new GitFixture(join(root, 'fixture'), 'Arborist')
  await fixture.init()

  const app = await launch(root, fixture.repoPath)
  const window = await app.firstWindow()
  await addProject(app)

  await window.getByTestId('project-switcher').click()
  await window.getByRole('menuitem', { name: 'App settings…' }).click()
  await window.getByRole('tab', { name: 'Presets' }).click()
  await window.getByRole('button', { name: 'New preset' }).click()
  await window.getByLabel('Name').fill('Build')
  // `exit 2` is the one failing command that means the same thing to bash and
  // to PowerShell, and this suite runs on both.
  await window.getByLabel('Command').fill('exit 2')
  await window.getByRole('button', { name: 'Save' }).click()
  // Both dialogs carry a Close button while the editor is unmounting, so wait
  // it out rather than closing whichever one wins the race.
  await expect(window.getByTestId('preset-editor')).toBeHidden()
  await window.keyboard.press('Escape')
  await expect(window.getByTestId('settings-dialog')).toBeHidden()

  await window.getByRole('button', { name: /main/ }).first().click()
  await window.getByRole('button', { name: 'Build' }).click()

  // The point of the console: a preset that fails says so, where a detached
  // launch would have failed out of sight.
  await expect(window.getByTestId('preset-console')).toBeVisible()
  await expect(window.getByTestId('preset-console-status')).toHaveText('Failed')
  await expect(window.getByTestId('preset-console')).toContainText('exit 2')

  await app.close()
  await rm(root, { recursive: true, force: true })
})

test('reaches the application picker from an application preset', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arborist-e2e-')))
  const fixture = new GitFixture(join(root, 'fixture'), 'Arborist')
  await fixture.init()

  // Two pickers, two answers, so the assertion says which one was reached.
  // `applicationPickerOptions` is unit-tested for what it asks the panel for;
  // this is the other half — that the button gets as far as asking. It did
  // not: the channel was declared in the contract and missing from the
  // preload's whitelist, so the click threw before main ever heard about it.
  const app = await launch(root, fixture.repoPath, {
    ARBORIST_PICK_APPLICATION: '/Applications/Sublime Text.app'
  })
  const window = await app.firstWindow()
  await addProject(app)

  await window.getByTestId('project-switcher').click()
  await window.getByRole('menuitem', { name: 'App settings…' }).click()
  await window.getByRole('tab', { name: 'Presets' }).click()
  await window.getByRole('button', { name: 'New preset' }).click()
  await window.getByLabel('Opens').click()
  await window.getByRole('option', { name: 'An application' }).click()
  await window.getByRole('button', { name: 'Choose…' }).click()

  await expect(window.getByLabel('Application')).toHaveValue('/Applications/Sublime Text.app')

  await app.close()
  await rm(root, { recursive: true, force: true })
})

test('adds a preset from project settings and it shows up under Open In', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arborist-e2e-')))
  const fixture = new GitFixture(join(root, 'fixture'), 'Arborist')
  await fixture.init()

  const app = await launch(root, fixture.repoPath)
  const window = await app.firstWindow()
  await addProject(app)

  // Lands on main already, per the auto-select fallback — no extra click
  // needed to reach the Open In grid this preset should appear under.
  await window.getByRole('button', { name: 'Project settings' }).click()
  await window.getByRole('tab', { name: 'Presets' }).click()
  await window.getByTestId('project-presets').waitFor({ state: 'visible' })
  await window.getByRole('button', { name: 'New preset' }).click()
  await window.getByLabel('Name').fill('Storybook')
  await window.getByLabel('Command').fill('npm run storybook')
  await window.getByRole('button', { name: 'Save' }).click()
  await expect(window.getByTestId('preset-editor')).toBeHidden()
  await window.keyboard.press('Escape')
  await expect(window.getByTestId('project-settings-dialog')).toBeHidden()

  await expect(window.getByRole('button', { name: 'Storybook' })).toBeVisible()

  await app.close()
  await rm(root, { recursive: true, force: true })
})

test('creates a new branch from a base ref picked on the create-worktree dialog', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arborist-e2e-')))
  const fixture = new GitFixture(join(root, 'fixture'), 'Arborist')
  await fixture.init()
  // The main worktree sits on a branch other than main, with a commit
  // origin/main does not have, so basing on HEAD (the old default) and
  // basing on origin/main (picked explicitly) would diverge — proof the
  // picked ref is what actually got used, not silently ignored.
  await fixture.git(['checkout', '-b', 'other'])
  await fixture.commit('Only on other', { 'other.txt': 'other' })

  const app = await launch(root, fixture.repoPath)
  const window = await app.firstWindow()
  await addProject(app)

  await window.getByRole('button', { name: 'New worktree', exact: true }).click()
  await window.getByLabel('Branch', { exact: true }).fill('from-origin-main')
  await window.getByTestId('branch-existence').waitFor({ state: 'visible' })

  await window.getByRole('combobox').click()
  await window.getByPlaceholder('Search branches…').fill('origin/main')
  await window.getByRole('option', { name: 'origin/main' }).click()
  await expect(window.getByRole('combobox')).toHaveText('origin/main')
  await expect(window.getByTestId('branch-existence')).toContainText('created from origin/main')

  await window.getByRole('button', { name: 'Create' }).click()
  // Landing on main already (the auto-select fallback) means the detail pane
  // is visible before this click, too — waiting for it to reappear proves
  // nothing. Waiting for the new branch's own name in it is what actually
  // confirms the app has moved on to the worktree just created, rather than
  // still showing main while everything below races ahead of it.
  await expect(window.getByTestId('worktree-detail')).toContainText('from-origin-main')

  // The path actually used, read back from the app rather than assumed as
  // the sibling-of-repoPath convention `worktrees:suggestPath` happens to
  // follow: reconstructing it independently is a second implementation of
  // that convention, and the two can disagree about exactly the same string
  // without either being wrong — e.g. a short-form vs. long-form temp path
  // on Windows, which both resolve to the same directory but compare unequal.
  const worktreePath = await window.getByTitle('Copy path').innerText()

  // `worktree add -b <branch> <path> <baseRef>` only moves the branch
  // pointer to baseRef — it makes no commit of its own — so the base has to
  // be read off the first commit made afterwards, in the worktree the app
  // just created.
  const originMain = (await fixture.git(['rev-parse', 'origin/main'])).trim()
  const otherTip = (await fixture.git(['rev-parse', 'other'])).trim()
  await fixture.commit('First commit on the new branch', { 'new.txt': 'new' }, worktreePath)
  const parent = (await fixture.git(['log', '-1', '--format=%P', 'from-origin-main'])).trim()
  expect(parent).toBe(originMain)
  expect(parent).not.toBe(otherTip)

  await app.close()
  await rm(root, { recursive: true, force: true })
})

test('filters the base-ref combobox as you type, against a fixture with 30 branches', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arborist-e2e-')))
  const fixture = new GitFixture(join(root, 'fixture'), 'Arborist')
  await fixture.init()
  for (let i = 1; i <= 30; i++) {
    await fixture.git(['branch', `topic/${i}`])
  }

  const app = await launch(root, fixture.repoPath)
  const window = await app.firstWindow()
  await addProject(app)

  await window.getByRole('button', { name: 'New worktree', exact: true }).click()
  await window.getByLabel('Branch', { exact: true }).fill('feature/x')
  await window.getByRole('combobox').click()

  const options = window.getByRole('option')
  await expect(options).toHaveCount(32) // HEAD, main, and the 30 topic branches.

  await window.getByPlaceholder('Search branches…').fill('topic/17')
  await expect(options).toHaveCount(1)
  await expect(options.first()).toHaveText('topic/17')

  await app.close()
  await rm(root, { recursive: true, force: true })
})

test('walks both confirmations to delete a dirty worktree', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arborist-e2e-')))
  const fixture = new GitFixture(join(root, 'fixture'), 'Arborist')
  await fixture.init()
  const dirty = await fixture.addWorktree('dirty', { branch: 'feature/dirty' })
  await writeFile(join(dirty, 'README.md'), 'edited but not committed\n', 'utf8')

  const app = await launch(root, fixture.repoPath)
  const window = await app.firstWindow()
  await addProject(app)

  await window.getByRole('button', { name: /feature\/dirty/ }).click()
  await window.getByRole('button', { name: 'Worktree actions' }).click()
  await window.getByRole('menuitem', { name: 'Delete worktree…' }).click()
  await window.getByRole('button', { name: 'Delete', exact: true }).click()

  // The second dialog is the whole point: a dirty worktree cannot be deleted
  // by one click.
  await expect(window.getByTestId('force-delete-worktree-dialog')).toBeVisible()
  await window.getByRole('button', { name: 'Force delete' }).click()

  // Both dialogs closing is what says the removal succeeded — a failure keeps
  // them open with the reason. Asserting on the sidebar first would not: a
  // modal marks the rest of the app aria-hidden, so the row "disappears" from
  // the accessibility tree either way.
  await expect(window.getByTestId('force-delete-worktree-dialog')).toBeHidden()
  await expect(window.getByTestId('delete-worktree-dialog')).toBeHidden()
  await expect(window.getByRole('button', { name: /feature\/dirty/ })).toHaveCount(0)
  await expect
    .poll(async () =>
      readdir(dirty).then(
        (entries) => entries.join(', '),
        () => 'gone'
      )
    )
    .toBe('gone')

  await app.close()
  await rm(root, { recursive: true, force: true })
})
