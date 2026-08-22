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

## Regenerating the Icons

`resources/icon.png` at 1024×1024 is the source of truth. `build/icon.icns`,
`build/icon.ico`, and `build/icon.png` are generated from it and committed,
because electron-builder's config points at them by name and a build should not
depend on a conversion step nobody can see the output of.

To regenerate after changing the source:

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
`icns`, and 16 through 256 for `ico`.

## Secrets the Workflow Needs

These are repository secrets under **Settings → Secrets and variables →
Actions**. `GH_TOKEN` is the built-in `GITHUB_TOKEN` and needs no setup.

| Secret                        | What it is                                              |
| ----------------------------- | ------------------------------------------------------- |
| `MAC_CSC_LINK`                | Developer ID Application certificate as a base64 `.p12` |
| `MAC_CSC_KEY_PASSWORD`        | The password for that `.p12`                            |
| `APPLE_ID`                    | The Apple ID that owns the certificate                  |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID              |
| `APPLE_TEAM_ID`               | The team the certificate belongs to                     |

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
3. Base64 it, and put the result in `MAC_CSC_LINK`:
   ```bash
   base64 -i certificate.p12 | pbcopy
   ```
4. Put the `.p12` password in `MAC_CSC_KEY_PASSWORD`.
5. Create an app-specific password at [appleid.apple.com](https://appleid.apple.com)
   under **Sign-In and Security → App-Specific Passwords**, and put it in
   `APPLE_APP_SPECIFIC_PASSWORD`. Your real Apple ID password will not work.
6. `APPLE_TEAM_ID` is the ten-character team id in the developer portal's
   membership page. Arborist v1 used `NAVFGLVP2P`.

The certificate expires after five years and the release job will start failing
on the day it does, with an error about no identity being found. Worth a
calendar entry.

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
