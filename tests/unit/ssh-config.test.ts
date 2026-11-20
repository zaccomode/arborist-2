import { describe, expect, it } from 'vitest'
import { SshHostResolver } from '../../src/main/services/system/ssh-config'

describe('SshHostResolver (#166)', () => {
  it("resolves an alias to ssh's hostname, once per host", async () => {
    const calls: string[] = []
    const resolver = new SshHostResolver(async (host) => {
      calls.push(host)
      return `user git\nhostname ${host === 'github-work' ? 'github.com' : host}\n`
    })
    expect(await resolver.resolve('github-work')).toBe('github.com')
    expect(await resolver.resolve('github-work')).toBe('github.com')
    expect(calls).toEqual(['github-work'])
  })

  it('falls back to the host as written when ssh fails or says nothing', async () => {
    const failing = new SshHostResolver(() => Promise.reject(new Error('spawn ssh ENOENT')))
    expect(await failing.resolve('github-work')).toBe('github-work')
    const silent = new SshHostResolver(async () => '')
    expect(await silent.resolve('github-work')).toBe('github-work')
  })

  it('retries a host whose lookup failed, rather than keeping the fallback (#168)', async () => {
    let attempts = 0
    const resolver = new SshHostResolver(async () => {
      attempts++
      if (attempts === 1) throw new Error('ssh -G timed out')
      return 'hostname github.com\n'
    })
    expect(await resolver.resolve('github-work')).toBe('github-work')
    expect(await resolver.resolve('github-work')).toBe('github.com')
    expect(await resolver.resolve('github-work')).toBe('github.com')
    expect(attempts).toBe(2)
  })

  it('shares one lookup between callers that ask while it is running', async () => {
    let attempts = 0
    const resolver = new SshHostResolver(async () => {
      attempts++
      return 'hostname github.com\n'
    })
    const both = await Promise.all([
      resolver.resolve('github-work'),
      resolver.resolve('github-work')
    ])
    expect(both).toEqual(['github.com', 'github.com'])
    expect(attempts).toBe(1)
  })

  it('never runs ssh for a host it could read as an option', async () => {
    const calls: string[] = []
    const resolver = new SshHostResolver(async (host) => {
      calls.push(host)
      return 'hostname evil.example\n'
    })
    expect(await resolver.resolve('-oProxyCommand=touch /tmp/x')).toBe(
      '-oProxyCommand=touch /tmp/x'
    )
    expect(calls).toEqual([])
  })
})
