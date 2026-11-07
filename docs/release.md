# Releasing

Arborist ships through GitHub Releases, and updates itself from the same place
via `electron-updater`. This document is the runbook and the list of secrets the
release workflow needs.

## Cutting a Release

1. Open a pull request that bumps `version` in `package.json`, and merge it
   into `main`. Merging is the decision to release, so nothing else needs to
   happen until the draft appears.
2. Once CI passes on the merge, `.github/workflows/tag-release.yml` sees that
   the version changed, tags that commit `v` plus the version, and starts
   `.github/workflows/release.yml` on the tag.
3. `release.yml` checks the tag against `package.json`, then builds macOS and
   Windows in parallel and uploads a **draft** release.
4. Download the artifacts from the draft and install one on each platform.
   `docs/manual-checklist.md` is the pass to run.
5. Publish the release in the GitHub UI, **once the workflow run is green**.
   A red run leaves a draft behind that looks publishable and is not; the
   `assert-complete` and `mark-incomplete-draft` jobs below are what make that
   visible from the Releases list. Tick **Set as a pre-release** for anything
   with a prerelease version, so it never becomes the release that stable
   installs update to.

Nothing in the first three steps needs `git tag`, which matters for agents: the
cloud sandboxes they run in can push their own branch but not a tag. An agent
can do the first step completely, and a human merging its pull request is the
approval.

The tag is created only when the commit CI ran on changes the version, compared
with its first parent, which for a merge is `main` as it was beforehand. A
version bump buried in the middle of a direct push of several commits is
therefore missed. In that case run **Actions → Tag release → Run workflow** on
`main`, which tags `main`'s current head. That path does not wait for CI, so
check that the head is green first.

Pushing the tag by hand still works, and is the fallback if `tag-release.yml`
ever fails:

```bash
git tag v1.2.0 && git push origin v1.2.0
```

When the hand-pushed tag gets there first, `tag-release.yml` finds it and does
nothing, so the two cannot both start a build.

There should be exactly **one** draft per tag, holding both platforms' artifacts
and both `*.yml` manifests — twelve assets in all. Publishing a half-filled one
ships an update that some users cannot install.

Two jobs now stand between a bad build and a published release, and both exist
because v3.4.0 got past a human who was looking:

- **`assert-complete`** runs after both builds and asks GitHub what the release
  actually carries. It derives the expected names from `electron-builder.yml`
  and the version, checks every asset's `state` is `uploaded`, and checks the
  sizes in `latest-mac.yml` and `latest.yml` against the uploaded assets they
  point at — a manifest that disagrees with its binaries is as broken as a
  missing one. `scripts/release/assert-release-complete.ts` is the check, and
  it runs by hand against any release:

  ```bash
  node scripts/release/assert-release-complete.ts --tag v3.4.0 --repo zaccomode/arborist-2
  ```

- **`mark-incomplete-draft`** renames the draft to
  `v3.4.0 — INCOMPLETE, DO NOT PUBLISH` whenever anything in the chain failed.
  **A draft whose title says that must not be published**, whatever its assets
  list looks like. A re-run that passes `assert-complete` puts the plain tag
  back as the title, so the marker is only ever as stale as the last run.

The `verify` job creates that draft before either build starts, and fails if it
finds more than one for the tag. Both exist because electron-builder creates a
release when it cannot find one, and looks for it behind an async cache: two
artifacts finishing at the same moment both miss, both build a publisher, and
both create a draft. The mac build alone produces four artifacts in parallel
(dmg and zip, arm64 and x64), so it races itself, and no amount of serialising
the jobs helps. An existing draft is found rather than created, which is what
makes creating it up front the fix.

The draft step is the whole safety mechanism, so it is worth saying why it is
there: `electron-updater` serves whatever the latest **published** release says.
A release published automatically is a release auto-installed onto everyone
before anyone has opened it. Building automatically and publishing by hand keeps
the part a human is good at.

Tagging without bumping `package.json` first used to be the easiest mistake to
make, and it still is for a tag pushed by hand, which is why the workflow
asserts on it rather than trusting. The version in the About panel and the
version `electron-updater` compares against both come from `package.json`, so a
mismatched tag ships a build that lies about what it is. A tag made by
`tag-release.yml` is read from `package.json`, so it cannot disagree.

### Why the Tag Starts the Build Explicitly

`tag-release.yml` creates the tag with the built-in `GITHUB_TOKEN`, and GitHub
does not start workflows from events that token causes, so the new tag does not
fire `release.yml`'s `push` trigger. `workflow_dispatch` is the exception to
that rule, so `tag-release.yml` dispatches `release.yml` on the tag ref
instead. The run happens on the tag rather than on `main`, which is what lets
it reach the signing environment below.

If the tagging is ever moved to an App token or a personal access token, the
tag _will_ fire `push`, and the dispatch must be removed. Otherwise two release
runs start at once, both find no draft, and both create one — the split release
the `verify` job exists to prevent.

## Rehearsing a Release

Everything except the update path can be tested from the draft, without
publishing anything. Download the installers from the draft release itself
rather than from the workflow's artifacts, since the release assets are what
users actually get, then run `docs/manual-checklist.md` against them.

Download through a browser rather than with `curl`. The browser attaches the
quarantine attribute, and Gatekeeper only does its full check on a quarantined
file — a `curl`ed dmg opens cleanly whether or not notarisation worked, which
makes it a test that always passes.

**A tag whose release is still a draft breaks the updater.** The tag now exists
from the moment CI passes on the version bump, so this window opens when the
pull request merges, not when someone pushes a tag. The releases Atom
feed lists bare tags as well as releases, so `electron-updater` sees a tag the
moment it is pushed, takes it as the newest version, and then asks for a
manifest under a release that does not exist yet. The result is a 404 on
`rc-mac.yml` followed by a 404 on `latest-mac.yml`, since it falls back to the
default channel and the error it reports is the fallback's rather than the first
one's. Nothing is wrong with the build; the release simply has not been
published.

The consequence for rehearsals: publish the draft, or delete the tag. Leaving a
tag sitting in front of an unpublished draft points every installed prerelease
build at a version it cannot fetch.

**The update path cannot be rehearsed from a draft.** `electron-updater` reads
the releases Atom feed, which drafts never appear in, so an app pointed at a
repository whose only release is a draft reports that there is nothing to
update to. Testing an update needs two published releases, and the version
numbers have to be chosen with some care:

- **A prerelease build only ever updates to another prerelease on the same
  channel.** `electron-updater` turns `allowPrerelease` on by itself when the
  installed version has a prerelease component, and takes the channel from that
  component, so a `0.1.1-rc.2` build looks for other `rc` releases. Its channel
  matching only treats `alpha` and `beta` as channels that can also see stable
  releases, so an `rc` build will never move to a stable one. It reports "no
  published versions" instead.
- **A prerelease also publishes a differently named manifest.** electron-builder
  infers the channel from the version too, so `0.1.1-rc.2` writes `rc.yml` and
  `rc-mac.yml` rather than `latest.yml` and `latest-mac.yml`.

Both of those are consistent with each other, so an `rc.2` → `rc.3` rehearsal
works end to end and costs no real version numbers. What it does not prove is
the first stable release, since that is the one hop the channel logic refuses.

The practical consequence is worth stating plainly: **anyone left on a
prerelease build never receives a stable release.** Uninstall a rehearsal build
rather than leaving it on the machine, and do not hand one to anybody without
saying so.

To re-cut a release without moving the tag, run the workflow by hand from
**Actions → Release → Run workflow** and pick the tag in the ref picker. Picking
a branch there fails in the first job with a message saying so, because the
signing environment below is reachable only from a tag.

## Rolling Back a Bad Release

`electron-updater` follows the latest published release, so pulling a bad one is
a matter of making an older release the latest again.

1. In the GitHub UI, edit the bad release and either **delete** it or convert it
   back to a draft. Both remove it from the update feed.
2. Confirm the previous release is now marked "Latest". If it is not, edit it
   and tick **Set as the latest release**.
3. Anyone who already installed the bad version stays on it: `electron-updater`
   only ever moves forward, so it will not roll them back. Getting them off it
   means publishing a **higher** version with the fix, which is the honest path
   anyway.
4. Delete the tag as well, so the version number is not reused for a different
   build:
   ```bash
   git push --delete origin v1.2.0 && git tag -d v1.2.0
   ```
   Later merges will not put it back. `tag-release.yml` only tags a commit
   that changes the version, so the tag is recreated only if someone runs it by
   hand while `package.json` still says `1.2.0`. The fix in step 3 bumps past
   it anyway.

### Re-cutting a Release That Has Already Been Published

**Re-running `release.yml` on the tag does not work while the release is
published. The run goes green having uploaded nothing.**

This is worth knowing before it costs an afternoon, because every signal says
it worked: the builds pass, the signing assertions pass, the smoke-check
artifacts appear, the job summary is clean. The only trace is one `warn` line
buried in the build log — `GitHub release not created`, with
`reason: existing type not compatible with publishing type`.

The cause is in `electron-publish`. `getOrCreateRelease`
(`node_modules/electron-publish/out/gitHubPublisher.js`) looks for a release
matching the tag; if it finds one that is **not** a draft while
`releaseType` is `draft` — which is what `electron-builder.yml` sets, and
deliberately — it logs that warning and returns `null`. Every upload after
that is skipped, and nothing treats it as an error. The relevant upstream
issues are linked in the source: electron-builder#1197 and #2072.

So the order matters. Convert the release back to a draft **first**:

```bash
gh release edit v3.4.0 --draft=true
```

Then re-run **Actions → Release → Run workflow** on the tag.

Un-publishing has a second effect worth having on purpose: it takes the release
out of the update feed immediately, which restores the previous release as
Latest and stops whatever the broken one was doing to installed copies. During
the v3.4.0 incident that one command was what ended the 404s users were seeing
on every update check — before anything was rebuilt.

Two things to check once the re-run finishes:

- `assert-complete` passed, and the draft's title is the bare tag again rather
  than the `INCOMPLETE, DO NOT PUBLISH` marker.
- The assets are the new ones. electron-builder overwrites an asset of the same
  name, but an asset left over from a _differently_ named target would survive,
  and `assert-complete` only asserts that what should be there is there.

## The Icons

There are two sources, because macOS 26 wants a layered icon and nothing else
does.

**macOS: `build/icon.icon`**, an Icon Composer bundle. `mac.icon` points at it,
and electron-builder runs `actool` over it once, taking both of its outputs: the
`Assets.car` that macOS 26 renders as a layered icon, and an `Icon.icns`
generated from the same artwork for every older version. One file feeds both, so
there is no second icon to keep in sync.

That puts `actool` on the critical path, and it throws rather than degrading
when it is missing or older than 26. Two consequences worth knowing before they
bite:

- A Mac without Xcode 26 cannot run `npm run build:mac` at all. The error names
  `actool`, not the icon.
- The release workflow pins `macos-26` rather than using `macos-latest`, so a
  future rollover of that label cannot quietly take Xcode 26 away.

To back the whole thing out, point `mac.icon` at `build/icon.icns` instead. That
file is still committed and still current; it is simply no longer read.

**Windows and everything else: `resources/icon.png`** at 1024×1024.
`build/icon.ico` is generated from it and committed, because `win.icon` points
at it by name and a build should not depend on a conversion step nobody can see
the output of. `build/icon.png` is the same image, kept as the human-readable
reference.

To regenerate after changing the PNG:

```bash
cp resources/icon.png build/icon.png
node -e "
const { runIconsTool } = require('./node_modules/app-builder-lib/out/toolsets/icons.js')
Promise.all(['icns', 'ico'].map((format) =>
  runIconsTool({ inputFile: 'resources/icon.png', outputFormat: format, outDir: 'build' })
)).catch((error) => { console.error(error); process.exit(1) })
"
```

That is electron-builder's own converter rather than a second tool with its own
opinion about downscaling, so the output is what electron-builder would have
produced had the config pointed at the PNG. It downloads a toolset bundle on
first use. The result carries 16 through 1024 including the retina variants for
`icns`, and 16 through 256 for `ico`. The `icns` is regenerated alongside the
`ico` so the escape hatch above stays current, even though the mac build no
longer reads it.

## How macOS Signing Is Set Up

The workflow imports the certificate into a keychain of its own and points
electron-builder at it with `CSC_KEYCHAIN`, rather than handing it `CSC_LINK`
and letting it manage a keychain itself. That is a workaround, and it is worth
knowing what it works around, because the shape of the failure is memorable: a
release that had worked for months failed with

```
security: SecKeychainUnlock: The user name or passphrase you entered is not correct.
```

on a commit where nothing relevant had changed — same electron-builder, same
lockfile, same workflow, same pinned `macos-26` label.

electron-builder passes the **certificate** password to
`security set-key-partition-list -k`, where that flag takes the **keychain**
password (app-builder-lib 26.15.3, `codeSign/macCodeSign.js`; the keychain's
real password is a random string generated thirty lines earlier). The argument
has always been wrong. It never mattered, because the keychain had just been
unlocked and `security` therefore never had cause to check it. What changed was
the runner: the `macos-26` image went from macOS 25.5.0 at v3.0.1 to 25.6.0 at
v3.0.2, the keychain is locked by the time that call is made, the wrong password
is finally consulted, and signing stops there.

Pinning the label did not help, and could not: a label pins the major version,
not the image. The `os=` field in electron-builder's first log line is the
number that moves, and the first thing to compare against a release that worked
when a mac build starts behaving differently for no reason.

With `CSC_LINK` absent from the environment, electron-builder does not create a
keychain at all and signs against whatever `CSC_KEYCHAIN` names, so the broken
call is never reached. `CSC_LINK` has to be genuinely absent: an empty string
still counts as set.

Two things to keep in mind if this is ever revisited:

- **The "Assert the macOS build is signed" step is what makes this safe to
  change.** electron-builder skips signing rather than failing when it cannot
  find an identity, so a mistake here would otherwise ship an unsigned build
  through a green job. That step fails the build instead.
- **The certificate is deliberately not given to the Windows job.** It used to
  be: `CSC_LINK` was set for the whole matrix, so `signtool` signed every
  Windows binary with the Apple Developer ID `.p12` — visible in the release
  logs up to and including v3.0.2 as `signing … certificateFile=…\1.p12`. An
  Apple certificate chains to nothing Windows trusts, so this bought nothing; it
  simply used the Apple signing key for something it was never issued for.
  Windows builds are now unsigned, which is what `electron-builder.yml` and the
  README have said all along. Signing them properly remains a matter of adding
  Windows credentials, not of undoing this.

## Secrets the Workflow Needs

These belong to a **deployment environment**, not to the repository. Create it
under **Settings → Environments → New environment**, name it `release`, and add
the secrets there. `GH_TOKEN` is the built-in `GITHUB_TOKEN` and needs no setup.

| Secret                        | What it is                                              |
| ----------------------------- | ------------------------------------------------------- |
| `MAC_CSC_LINK`                | Developer ID Application certificate as a base64 `.p12` |
| `MAC_CSC_KEY_PASSWORD`        | The password for that `.p12`                            |
| `APPLE_ID`                    | The Apple ID that owns the certificate                  |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID              |
| `APPLE_TEAM_ID`               | The team the certificate belongs to                     |

The first two reach only the macOS job's own "Import the signing certificate"
step. The section above says why they are not handed to electron-builder as
`CSC_LINK` and `CSC_KEY_PASSWORD`, and why they are not handed to the Windows
job at all.

Give the environment one protection rule: under **Deployment branches and
tags**, select **Selected branches and tags**, add a rule of type **tag** with
the pattern `v*`, and add no branch rule at all.

That rule is the reason for the environment. A repository secret is readable by
any workflow run on any ref, so a workflow added on a throwaway branch could
print the certificate. An environment secret is readable only by a job that
names the environment, and only from a ref the policy allows — which here means
a release tag and nothing else. The `build` job names it; `verify` does not,
because it has no need of a certificate to compare two strings.

Required reviewers are deliberately not enabled. The gate that matters is
already there in the draft release, and a second approval click on a project
with one maintainer is ceremony rather than a control. That changes the day
somebody else gets push access.

**Without these, the macOS job still succeeds and produces an unsigned,
un-notarised build that Gatekeeper will refuse to open.** electron-builder skips
signing rather than failing, which is convenient locally and dangerous in a
release, so check that the mac job's log says it signed before publishing.

### Getting the macOS Certificate Into CI

1. In the Apple Developer portal, create a **Developer ID Application**
   certificate and install it into your login keychain.
2. In Keychain Access, right-click the certificate, **Export**, and save a
   `.p12` with a password. Export the certificate together with its private key,
   which is the row you get by expanding the certificate's disclosure triangle.

   Keychain Access asks for two passwords here, one after the other. The first
   sets the password on the `.p12`; the second is your login keychain password,
   authorising the export. Only the first one is the secret. Saving the second
   is the usual cause of the PKCS12 failure below.

3. Base64 it, and put the result in `MAC_CSC_LINK`:
   ```bash
   base64 -i certificate.p12 | pbcopy
   ```
4. Put the `.p12` password in `MAC_CSC_KEY_PASSWORD`.
5. `APPLE_ID` is an email address rather than a number: the Apple Account you
   sign in to the developer portal with, the one enrolled in the Developer
   Program. That is what `notarytool` means by "Apple ID".
6. Create an app-specific password at [appleid.apple.com](https://appleid.apple.com)
   under **Sign-In and Security → App-Specific Passwords**, and put it in
   `APPLE_APP_SPECIFIC_PASSWORD`. Your real Apple ID password will not work, and
   neither will one created under a different Apple Account than `APPLE_ID`.
7. `APPLE_TEAM_ID` is a ten-character string at
   [developer.apple.com/account](https://developer.apple.com/account) under
   **Membership details**. Arborist v1 used `NAVFGLVP2P`.

Worth checking the team id against the certificate rather than against the
portal, since the portal tells you what teams the account belongs to and the
secret has to name the one the certificate was issued to:

```bash
security find-identity -v -p codesigning
```

That prints the identity as `Developer ID Application: Your Name (NAVFGLVP2P)`,
and the part in brackets is the team id. A disagreement between the two shows up
as a notarisation failure that does not mention team ids at all.

The certificate expires after five years and the release job will start failing
on the day it does, with an error about no identity being found. Worth a
calendar entry.

### Checking the Certificate Before Cutting a Release

Every mistake in this section costs a version bump, a tag, a build, and the wait for two
notarisation submissions before it tells you about itself. Both of the things
that go wrong can be checked locally in a second.

That the password matches the `.p12`:

```bash
openssl pkcs12 -in certificate.p12 -noout -passin pass:'the-password'
```

And that what is stored in `MAC_CSC_LINK` decodes back to that same file:

```bash
pbpaste | base64 --decode > /tmp/roundtrip.p12
openssl pkcs12 -in /tmp/roundtrip.p12 -noout -passin pass:'the-password'
```

Exit code 0 means both are right. If either complains about **algorithms**
rather than about the password, add `-legacy`: that is OpenSSL 3 refusing the
older ciphers Keychain Access exports with, and says nothing about whether the
password is correct. macOS ships LibreSSL as `openssl`, which does not need it.

The failure this heads off reads, in the release log:

```
security: SecKeychainItemImport: MAC verification failed during PKCS12 import (wrong password?)
```

Despite appearances that is good news about everything except the password: the
secrets reached the job, and the base64 decoded into a file `security` was
willing to try. Only `MAC_CSC_KEY_PASSWORD` is wrong.

## Windows Code Signing

**Arborist's Windows builds are unsigned, and shipping them that way is a
deliberate choice rather than an oversight.** SmartScreen interposes on every
download until a signature accrues reputation, and
`docs/troubleshooting.md` tells users what they will see and how to get past it.
That is the least bad version of not signing. What would not be acceptable is
deferring the signature quietly.

Azure Trusted Signing is currently the cheapest legitimate route, at roughly
USD $10/month with no up-front certificate purchase, and it signs on Microsoft's
side so no private key ever reaches the CI runner. The steps, when you want
them:

1. In the Azure portal, create a **Trusted Signing** account. It is region
   limited, so pick one that offers it.
2. Complete **identity validation** for the account. An individual needs
   government ID; an organisation needs a D-U-N-S number and a verifiable
   business address. This is the part with a lead time: allow several business
   days, and up to a few weeks for an organisation.
3. Once validated, create a **certificate profile** of type Public Trust.
4. Register an Entra ID app registration for CI, and give it the **Trusted
   Signing Certificate Profile Signer** role on the account.
5. Add `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET` as
   repository secrets, plus the account name, endpoint, and profile name.
6. Add the signing step to the Windows job in `release.yml`. The
   `azure/trusted-signing-action` action is the supported route; electron-builder
   picks up the signed binaries if it runs after packaging, or you can wire it as
   electron-builder's `win.sign` hook.

An OV certificate from a commercial CA is the fallback if Trusted Signing is not
available in your region. It costs more, arrives on a hardware token or in an
HSM, and needs `signtool` on the runner.

Note that a signature is not an instant fix for SmartScreen. Reputation accrues
per-certificate over downloads and time, so the first few hundred installs of a
newly signed build still see the warning. An EV certificate skips the wait, and
costs considerably more.
