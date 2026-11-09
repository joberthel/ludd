import process from 'node:process'
import { describe, expect, it } from 'vitest'
import {
  buildIsolatedEnvironmentVars,
  SAFE_BASELINE_KEYS,
} from './env-sanitizer.js'

describe('buildIsolatedEnvironmentVars baseline and default-deny', () => {
  it('retains baseline safe system variables present in hostProcessEnv', () => {
    const mockHost: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/bin',
      HOME: '/Users/test',
      USER: 'testuser',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      TMPDIR: '/tmp/test',
      GITHUB_TOKEN: 'ghp_secret123',
      SSH_AUTH_SOCK: '/tmp/ssh.sock',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
    }

    const isolated = buildIsolatedEnvironmentVars({ hostProcessEnv: mockHost })

    for (const key of SAFE_BASELINE_KEYS) {
      expect(isolated[key]).toBe(mockHost[key])
    }

    expect(isolated.GITHUB_TOKEN).toBeUndefined()
    expect(isolated.SSH_AUTH_SOCK).toBeUndefined()
    expect(isolated.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })

  it('omits baseline variables when not present in hostProcessEnv', () => {
    const mockHost: NodeJS.ProcessEnv = {
      PATH: '/bin',
    }

    const isolated = buildIsolatedEnvironmentVars({ hostProcessEnv: mockHost })

    expect(isolated.PATH).toBe('/bin')
    expect(isolated.HOME).toBeUndefined()
    expect(isolated.USER).toBeUndefined()
  })

  it('defaults to process.env when options or hostProcessEnv omitted', () => {
    const isolatedWithoutOpts = buildIsolatedEnvironmentVars()
    const isolatedEmptyOpts = buildIsolatedEnvironmentVars({})

    if (process.env.PATH !== undefined) {
      expect(isolatedWithoutOpts.PATH).toBe(process.env.PATH)
      expect(isolatedEmptyOpts.PATH).toBe(process.env.PATH)
    }
  })
})

describe('buildIsolatedEnvironmentVars explicit whitelisting', () => {
  it('includes whitelisted host keys when defined', () => {
    const mockHost: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      NPM_TOKEN: 'npm_pkg_secret',
      SSH_AUTH_SOCK: '/tmp/ssh.sock',
      UNWHITELISTED_SECRET: 'super-secret',
    }

    const isolated = buildIsolatedEnvironmentVars({
      hostProcessEnv: mockHost,
      whitelistEnv: ['NPM_TOKEN', 'SSH_AUTH_SOCK', 'NON_EXISTENT_VAR'],
    })

    expect(isolated.NPM_TOKEN).toBe('npm_pkg_secret')
    expect(isolated.SSH_AUTH_SOCK).toBe('/tmp/ssh.sock')
    expect(isolated.NON_EXISTENT_VAR).toBeUndefined()
    expect(isolated.UNWHITELISTED_SECRET).toBeUndefined()
  })
})

describe('buildIsolatedEnvironmentVars merge hierarchy', () => {
  it('applies hierarchy: baseline -> whitelist -> staticEnv -> injectedEnv', () => {
    const mockHost: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      API_URL: 'http://default.host',
      SHARED_SECRET: 'host-secret',
    }

    const isolated = buildIsolatedEnvironmentVars({
      hostProcessEnv: mockHost,
      whitelistEnv: ['API_URL', 'SHARED_SECRET'],
      staticEnv: {
        SHARED_SECRET: 'static-override',
        STATIC_KEY: 'static-val',
        PATH: '/custom/bin',
      },
      injectedEnv: {
        STATIC_KEY: 'injected-override',
        MCP_AUTH_TOKEN: 'ephemeral-bearer',
      },
    })

    expect(isolated.PATH).toBe('/custom/bin')
    expect(isolated.API_URL).toBe('http://default.host')
    expect(isolated.SHARED_SECRET).toBe('static-override')
    expect(isolated.STATIC_KEY).toBe('injected-override')
    expect(isolated.MCP_AUTH_TOKEN).toBe('ephemeral-bearer')
  })
})
