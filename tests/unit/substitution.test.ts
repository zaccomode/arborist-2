import { describe, it, expect } from 'vitest'
import { findUnknownTokens, substitute, type SubstitutionValues } from '@shared/substitution'

const values: SubstitutionValues = {
  path: '/Users/iso/code/feature-x',
  branch: 'feature/ABC-123',
  commitHash: 'abc1234',
  repoName: 'arborist',
  repoPath: '/Users/iso/code/arborist',
  filePath: null,
  fileLine: null
}

/** A value chosen to break every unescaped destination at once. */
const hostile: SubstitutionValues = {
  ...values,
  path: `/tmp/it's a "path"; rm -rf $HOME \`whoami\``,
  branch: `feature/don't $do this`
}

describe('substitute', () => {
  it('replaces every known token', () => {
    const result = substitute(
      '{{path}} {{branch}} {{commitHash}} {{repoName}} {{repoPath}}',
      values,
      'raw'
    )

    expect(result).toBe(
      '/Users/iso/code/feature-x feature/ABC-123 abc1234 arborist /Users/iso/code/arborist'
    )
  })

  it('tolerates whitespace inside the braces', () => {
    expect(substitute('{{ branch }}', values, 'raw')).toBe('feature/ABC-123')
  })

  it('substitutes a null value as empty', () => {
    expect(substitute('[{{commitHash}}]', { ...values, commitHash: null }, 'raw')).toBe('[]')
  })

  it('substitutes a null filePath/fileLine as empty, same as any other null token', () => {
    expect(substitute('[{{filePath}}:{{fileLine}}]', values, 'raw')).toBe('[:]')
  })

  it('stringifies fileLine, the one numeric token', () => {
    const withFile = { ...values, filePath: '/Users/iso/code/feature-x/uu.txt', fileLine: 12 }
    expect(substitute('{{filePath}}:{{fileLine}}', withFile, 'raw')).toBe(
      '/Users/iso/code/feature-x/uu.txt:12'
    )
  })

  it('leaves an unknown token exactly as written', () => {
    expect(substitute('{{path}} {{noSuchToken}}', values, 'raw')).toBe(
      '/Users/iso/code/feature-x {{noSuchToken}}'
    )
  })

  describe('posix', () => {
    it('quotes a value with spaces', () => {
      expect(substitute('code {{path}}', values, 'posix')).toBe(`code '/Users/iso/code/feature-x'`)
    })

    it('neutralises quotes, expansion and command separators', () => {
      expect(substitute('{{path}}', hostile, 'posix')).toBe(
        `'/tmp/it'\\''s a "path"; rm -rf $HOME \`whoami\`'`
      )
    })

    it('leaves the surrounding command the user wrote alone', () => {
      expect(substitute('cd {{path}} && npm install', values, 'posix')).toBe(
        `cd '/Users/iso/code/feature-x' && npm install`
      )
    })
  })

  describe('powershell', () => {
    it('quotes a value with spaces', () => {
      expect(substitute('code {{path}}', values, 'powershell')).toBe(
        `code '/Users/iso/code/feature-x'`
      )
    })

    it('doubles an embedded single quote rather than backslash-escaping it', () => {
      expect(substitute('{{branch}}', hostile, 'powershell')).toBe(`'feature/don''t $do this'`)
    })

    it('keeps a dollar sign literal inside the single quotes it adds', () => {
      expect(substitute('{{path}}', hostile, 'powershell')).toBe(
        `'/tmp/it''s a "path"; rm -rf $HOME \`whoami\`'`
      )
    })
  })

  describe('url', () => {
    it('encodes a branch containing a slash, a space and a hash', () => {
      expect(
        substitute(
          'x-app://open?branch={{branch}}',
          { ...values, branch: 'feature/ABC #123' },
          'url'
        )
      ).toBe('x-app://open?branch=feature%2FABC%20%23123')
    })

    it('encodes a path for a file URL', () => {
      expect(substitute('file://{{path}}', hostile, 'url')).toBe(
        `file://%2Ftmp%2Fit's%20a%20%22path%22%3B%20rm%20-rf%20%24HOME%20%60whoami%60`
      )
    })
  })

  describe('raw', () => {
    it('passes an argv value through untouched, since the OS does no parsing', () => {
      expect(substitute('{{path}}', hostile, 'raw')).toBe(hostile.path)
    })
  })
})

describe('findUnknownTokens', () => {
  it('finds nothing in a template of known tokens', () => {
    expect(findUnknownTokens('{{path}} {{branch}}')).toEqual([])
  })

  it('reports unknown tokens once each, in order', () => {
    expect(findUnknownTokens('{{wat}} {{path}} {{huh}} {{wat}}')).toEqual(['wat', 'huh'])
  })
})
