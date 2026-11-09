import { describe, expect, it } from 'vitest'
import { sh } from './sh-template.js'

describe('sh template tag POSIX escaping', () => {
  it('preserves literal strings when no interpolation is present', () => {
    expect(sh`git status --porcelain`).toBe('git status --porcelain')
  })

  it('escapes simple strings into single quotes', () => {
    const branch = 'feature/login'
    expect(sh`git checkout ${branch}`).toBe('git checkout \'feature/login\'')
  })

  it('safely escapes internal single quotes', () => {
    const msg = 'don\'t break the build'
    expect(sh`git commit -m ${msg}`).toBe('git commit -m \'don\'\\\'\'t break the build\'')
  })

  it('safely neutralizes subshell expansion and backticks (AC 5.2.1)', () => {
    const maliciousSubshell = '$(touch /tmp/pwned)'
    const maliciousBackticks = '`rm -rf /`'
    expect(sh`git commit -m ${maliciousSubshell}`).toBe('git commit -m \'$(touch /tmp/pwned)\'')
    expect(sh`git commit -m ${maliciousBackticks}`).toBe('git commit -m \'`rm -rf /`\'')
  })

  it('escapes numbers and booleans', () => {
    const count = 42
    const enabled = true
    const disabled = false
    expect(sh`cmd --count=${count} --active=${enabled} --test=${disabled}`).toBe(
      'cmd --count=\'42\' --active=\'true\' --test=\'false\'',
    )
  })

  it('escapes array of arguments joined by spaces', () => {
    const args = ['-a', '-b', 'arg with space']
    expect(sh`command ${args}`).toBe('command \'-a\' \'-b\' \'arg with space\'')
  })

  it('handles null and undefined values as empty quotes', () => {
    const n = null
    const u = undefined
    expect(sh`echo ${n} ${u}`).toBe('echo \'\' \'\'')
  })
})
