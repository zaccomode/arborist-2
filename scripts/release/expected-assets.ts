/**
 * What a complete release looks like, and whether a given one is.
 *
 * Written after v3.4.0 went out with five of its twelve assets missing.
 * GitHub's upload endpoint returned 500 on both Apple Silicon artifacts and
 * on the Windows installer, electron-publish exhausted its four retries, and
 * because the build task failed before electron-builder got to the last thing
 * it uploads, `latest-mac.yml` and `latest.yml` were never written at all.
 * The draft still looked publishable, and was published.
 *
 * The names are derived from `electron-builder.yml` rather than listed here,
 * so changing a target or an `artifactName` cannot leave the check asserting
 * yesterday's filenames. That means reimplementing a slice of
 * electron-builder's own macro expansion, which is only safe because it
 * refuses to guess: an unknown macro or an unmodelled target throws rather
 * than producing a plausible wrong name. Every rule below is taken from
 * app-builder-lib 26.x, and the comments name the file it came from.
 */

/** A `target:` entry, in either of the two forms the config allows. */
export type TargetSpec = string | { target: string; arch?: string[] }

export interface PlatformConfig {
  target?: TargetSpec | TargetSpec[]
  artifactName?: string
  defaultArch?: string
}

export interface BuilderConfig {
  productName?: string
  artifactName?: string
  mac?: PlatformConfig
  win?: PlatformConfig
  dmg?: { artifactName?: string }
  nsis?: { artifactName?: string }
  zip?: { artifactName?: string }
}

export interface PackageJson {
  name: string
  version: string
}

/** An asset as the GitHub releases API reports it. */
export interface ReleaseAsset {
  name: string
  size: number
  /** `uploaded`, or `starter` for an upload that began and never finished. */
  state: string
}

/** One `files:` entry of a `latest*.yml` update manifest. */
export interface ManifestFile {
  url: string
  size?: number
}

export interface Manifest {
  /** The asset name, e.g. `latest-mac.yml`. */
  name: string
  version?: string
  files?: ManifestFile[]
}

/**
 * The update channel electron-builder infers from the version, which decides
 * what the manifests are called: a stable version writes `latest.yml`, and a
 * `3.5.0-rc.1` writes `rc.yml`. Getting this wrong would fail every rehearsal
 * release, which is the one kind this project actually re-cuts.
 */
export function channelFor(version: string): string {
  const prerelease = /^\d+\.\d+\.\d+-([0-9A-Za-z]+)/.exec(version)
  return prerelease ? prerelease[1] : 'latest'
}

/**
 * app-builder-lib's `expandMacro` (util/macroExpander.ts), for the macros
 * this project's patterns use. Anything else throws, exactly as
 * electron-builder's own `ERR_ELECTRON_BUILDER_MACRO_NOT_DEFINED` does — a
 * macro silently expanding to nothing is how a check like this ends up
 * asserting a filename nobody builds.
 */
export function expandMacros(
  pattern: string,
  values: { name: string; productName: string; version: string; arch: string | null; ext: string }
): string {
  let expanded = pattern
  // With no arch to insert, the separator in front of the macro goes too —
  // which is why `Arborist-3.4.0-mac.zip` has one dash and not two.
  if (values.arch === null) {
    expanded = expanded
      .replace('-${arch}', '')
      .replace(' ${arch}', '')
      .replace('_${arch}', '')
      .replace('/${arch}', '')
  }
  return expanded.replace(/\$\{([_a-zA-Z./*+]+)\}/g, (_match, macro: string) => {
    switch (macro) {
      case 'name':
        return values.name
      case 'productName':
        return values.productName
      case 'version':
        return values.version
      case 'ext':
        return values.ext
      case 'arch':
        return values.arch ?? ''
      // `${os}` is the platform's build-configuration key, which for the only
      // target that uses it (the mac zip) is always `mac`.
      case 'os':
        return 'mac'
      default:
        throw new Error(
          `electron-builder.yml uses the \${${macro}} macro, which this check does not know how ` +
            `to expand. Teach scripts/release/expected-assets.ts about it, or the release guard ` +
            `will assert the wrong filenames.`
        )
    }
  })
}

/** The default arch, whose name electron-builder leaves out of some patterns. */
const DEFAULT_ARCH = 'x64'

/**
 * The targets this project builds, with the default name pattern
 * electron-builder would use for each when the config supplies none.
 *
 * `blockmap` records which of them also publish a `.blockmap` beside the
 * binary: it is what electron-updater reads to download only the changed
 * parts of an update, and a release missing one still updates, slowly. All
 * three of ours produce one.
 */
const TARGETS: Record<
  string,
  {
    ext: string
    blockmap: boolean
    /** Receives the arch so a target can vary its default by it, as nsis does. */
    defaultPattern: (arch: string) => string
    /**
     * Whether electron-builder drops the arch from the *default* pattern for
     * the default arch. A pattern given in the config is never trimmed this
     * way (`isUserForced` in platformPackager.ts), so this only applies when
     * the default pattern is in play.
     */
    skipDefaultArch: boolean
  }
> = {
  // dmg-builder/out/dmg.ts
  dmg: {
    ext: 'dmg',
    blockmap: true,
    defaultPattern: () => '${productName}-${version}-${arch}.${ext}',
    skipDefaultArch: true
  },
  // targets/ArchiveTarget.ts, which bakes the arch decision into the pattern
  // it passes and then asks for no further trimming.
  zip: {
    ext: 'zip',
    blockmap: true,
    defaultPattern: (arch) =>
      '${productName}-${version}' + (arch === DEFAULT_ARCH ? '' : '-${arch}') + '-${os}.${ext}',
    skipDefaultArch: false
  },
  // targets/nsis/NsisTarget.ts, whose arch suffix is empty for the default arch.
  nsis: {
    ext: 'exe',
    blockmap: true,
    defaultPattern: (arch) =>
      '${productName} Setup ${version}' + (arch === DEFAULT_ARCH ? '' : '-${arch}') + '.${ext}',
    skipDefaultArch: false
  }
}

function targetList(platform: PlatformConfig | undefined): { target: string; archs: string[] }[] {
  const raw = platform?.target
  const specs = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]
  return specs.map((spec) =>
    typeof spec === 'string'
      ? { target: spec, archs: [DEFAULT_ARCH] }
      : { target: spec.target, archs: spec.arch ?? [DEFAULT_ARCH] }
  )
}

export interface Expectation {
  /** Installers and archives: the things a user downloads. */
  binaries: string[]
  /** `<binary>.blockmap` for each binary that publishes one. */
  blockmaps: string[]
  /** `latest.yml` and `latest-mac.yml`, or the channel's equivalents. */
  manifests: string[]
  /** All of the above, which is what the release must carry. */
  all: string[]
}

/**
 * Every asset a complete release of `pkg.version` carries, derived from the
 * targets and `artifactName` patterns in `config`.
 */
export function expectedAssets(config: BuilderConfig, pkg: PackageJson): Expectation {
  const channel = channelFor(pkg.version)
  const binaries: string[] = []
  const blockmaps: string[] = []
  const manifests: string[] = []

  const platforms: { key: 'mac' | 'win'; platform: PlatformConfig | undefined }[] = [
    { key: 'mac', platform: config.mac },
    { key: 'win', platform: config.win }
  ]

  for (const { key, platform } of platforms) {
    const targets = targetList(platform)
    if (targets.length === 0) {
      throw new Error(`electron-builder.yml declares no ${key} targets, so nothing can be checked.`)
    }
    // electron-builder writes one manifest per platform it builds for, named
    // after the channel: the mac one carries the `-mac` infix.
    manifests.push(key === 'mac' ? `${channel}-mac.yml` : `${channel}.yml`)

    for (const { target, archs } of targets) {
      const descriptor = TARGETS[target]
      if (descriptor === undefined) {
        throw new Error(
          `electron-builder.yml builds the "${target}" target, which this check does not model. ` +
            `Add it to TARGETS in scripts/release/expected-assets.ts, including whether it ` +
            `publishes a .blockmap.`
        )
      }

      for (const arch of archs) {
        // Precedence from platformPackager.ts's artifactPatternConfig: the
        // target's own pattern, then the platform's, then the top level.
        const targetOptions = config[target as 'dmg' | 'nsis' | 'zip'] as
          { artifactName?: string } | undefined
        const configured =
          targetOptions?.artifactName ?? platform?.artifactName ?? config.artifactName
        const pattern = configured ?? descriptor.defaultPattern(arch)
        const skipArch = configured === undefined && descriptor.skipDefaultArch
        const name = expandMacros(pattern, {
          name: pkg.name,
          productName: config.productName ?? pkg.name,
          version: pkg.version,
          arch: skipArch && arch === DEFAULT_ARCH ? null : arch,
          ext: descriptor.ext
        })
        binaries.push(name)
        if (descriptor.blockmap) blockmaps.push(`${name}.blockmap`)
      }
    }
  }

  return { binaries, blockmaps, manifests, all: [...binaries, ...blockmaps, ...manifests] }
}

/**
 * Everything wrong with a release, as lines fit to print. Empty means it is
 * complete, which is the only state a human should be publishing.
 *
 * Three separate failures, because they have three different causes: an asset
 * that never arrived, an asset whose upload stalled half way (GitHub reports
 * those as `state: starter`, and they are downloadable as truncated files),
 * and a manifest that disagrees with the binaries beside it — which is what a
 * release re-cut over the top of a partial one looks like, and is every bit
 * as broken as a missing manifest.
 */
export function releaseProblems(input: {
  expected: Expectation
  assets: ReleaseAsset[]
  manifests: Manifest[]
  version: string
}): string[] {
  const { expected, assets, manifests, version } = input
  const problems: string[] = []
  const byName = new Map(assets.map((asset) => [asset.name, asset]))

  for (const name of expected.all) {
    if (!byName.has(name)) problems.push(`Missing asset: ${name}`)
  }

  for (const asset of assets) {
    if (asset.state !== 'uploaded') {
      problems.push(`Asset ${asset.name} is in state "${asset.state}" rather than "uploaded".`)
    }
  }

  for (const name of expected.manifests) {
    const manifest = manifests.find((candidate) => candidate.name === name)
    if (manifest === undefined) {
      // Already reported as missing above; nothing to cross-check.
      if (byName.has(name)) problems.push(`Could not read ${name} to check it against the assets.`)
      continue
    }
    if (manifest.version !== undefined && manifest.version !== version) {
      problems.push(
        `${name} describes version ${manifest.version}, but this release is ${version}.`
      )
    }
    const files = manifest.files ?? []
    if (files.length === 0) {
      problems.push(`${name} lists no files, so electron-updater has nothing to download.`)
    }
    for (const file of files) {
      // electron-builder percent-encodes anything that needs it in a url.
      const target = decodeURIComponent(file.url)
      const asset = byName.get(target)
      if (asset === undefined) {
        problems.push(`${name} points at ${target}, which this release does not carry.`)
        continue
      }
      if (file.size !== undefined && file.size !== asset.size) {
        problems.push(
          `${name} says ${target} is ${file.size} bytes, but the uploaded asset is ${asset.size}. ` +
            `A manifest that disagrees with its binaries fails every update that trusts it.`
        )
      }
    }
  }

  return problems
}
