# Releasing

Arborist ships through GitHub Releases, and updates itself from the same place
via `electron-updater`. This document is the runbook and the list of secrets the
release workflow needs.

## Cutting a Release

1. Bump `version` in `package.json` and commit it on `main`.
2. Tag that commit with the same version, prefixed with `v`, and push the tag:
   ```bash
   git tag v1.2.0 && git push origin v1.2.0
   ```
3. `.github/workflows/release.yml` checks the tag against `package.json` and
   fails immediately if they disagree, then builds macOS and Windows in
   parallel and uploads a **draft** release.
4. Download the artifacts from the draft and install one on each platform.
   `docs/manual-checklist.md` is the pass to run.
5. Publish the release in the GitHub UI.

The draft step is the whole safety mechanism, so it is worth saying why it is
there: `electron-updater` serves whatever the latest **published** release says.
A release published automatically is a release auto-installed onto everyone
before anyone has opened it. Building automatically and publishing by hand keeps
the part a human is good at.

Tagging without bumping `package.json` first is the mistake this is easiest to
make, which is why the workflow asserts on it rather than trusting. The version
in the About panel and the version `electron-updater` compares against both come
from `package.json`, so a mismatched tag ships a build that lies about what it
is.

## Rehearsing a Release

Everything except the update path can be tested from the draft, without
publishing anything. Download the installers from the draft release itself
rather than from the workflow's artifacts, since the release assets are what
users actually get, then run `docs/manual-checklist.md` against them.

Download through a browser rather than with `curl`. The browser attaches the
quarantine attribute, and Gatekeeper only does its full check on a quarantined
file — a `curl`ed dmg opens cleanly whether or not notarisation worked, which
makes it a test that always passes.

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

### Checking the Certificate Before Pushing a Tag

Every mistake in this section costs a tag, a build, and the wait for two
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
