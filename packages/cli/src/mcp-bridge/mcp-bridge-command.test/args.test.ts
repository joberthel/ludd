import { describe, expect, it } from 'vitest'
import { mcpBridgeCommand, parseMcpBridgeArgs } from '../mcp-bridge-command.js'

describe('parseMcpBridgeArgs', () => {
  it('parses --endpoint and --token CLI flags and trims values', () => {
    const config = parseMcpBridgeArgs(
      [
        '--endpoint',
        ' http://127.0.0.1:8080/mcp ',
        '--token',
        ' secret-123 ',
      ],
      {},
    )
    expect(config).toEqual({
      endpoint: 'http://127.0.0.1:8080/mcp',
      token: 'secret-123',
    })
  })

  it('falls back to LUDD_MCP_ENDPOINT and LUDD_MCP_TOKEN and lets CLI flags override env', () => {
    const fromEnv = parseMcpBridgeArgs([], {
      LUDD_MCP_ENDPOINT: 'https://localhost:9443/mcp',
      LUDD_MCP_TOKEN: 'env-token',
    })
    expect(fromEnv).toEqual({
      endpoint: 'https://localhost:9443/mcp',
      token: 'env-token',
    })

    const overridden = parseMcpBridgeArgs(
      [
        '--endpoint',
        'http://127.0.0.1:5000/mcp',
        '--token',
        'cli-token',
      ],
      {
        LUDD_MCP_ENDPOINT: 'https://localhost:9443/mcp',
        LUDD_MCP_TOKEN: 'env-token',
      },
    )
    expect(overridden).toEqual({
      endpoint: 'http://127.0.0.1:5000/mcp',
      token: 'cli-token',
    })
  })

  it('rejects positional arguments and unknown options', () => {
    expect(() =>
      parseMcpBridgeArgs([
        'extra-arg',
        '--endpoint',
        'http://127.0.0.1:1/mcp',
        '--token',
        't',
      ], {}),
    ).toThrow('Unexpected positional arguments for mcp-bridge.')

    expect(() =>
      parseMcpBridgeArgs(['--unknown', 'value'], {}),
    ).toThrow()
  })

  it('rejects missing, empty, malformed, or non-http endpoint URLs', () => {
    expect(() => parseMcpBridgeArgs(['--token', 't'], {})).toThrow(
      'Missing MCP endpoint URL (--endpoint or LUDD_MCP_ENDPOINT).',
    )
    expect(() => parseMcpBridgeArgs(['--endpoint', '   ', '--token', 't'], {})).toThrow(
      'Missing MCP endpoint URL (--endpoint or LUDD_MCP_ENDPOINT).',
    )
    expect(() => parseMcpBridgeArgs([
      '--endpoint',
      'not-a-url',
      '--token',
      't',
    ], {})).toThrow(
      'Invalid MCP endpoint URL: "not-a-url".',
    )
    expect(() => parseMcpBridgeArgs([
      '--endpoint',
      'ftp://127.0.0.1/mcp',
      '--token',
      't',
    ], {})).toThrow(
      'Invalid MCP endpoint URL protocol "ftp:". Expected http: or https:.',
    )
  })

  it('rejects missing or whitespace-only auth tokens', async () => {
    expect(() => parseMcpBridgeArgs(['--endpoint', 'http://127.0.0.1:8080/mcp'], {})).toThrow(
      'Missing MCP auth token (--token or LUDD_MCP_TOKEN).',
    )
    expect(() =>
      parseMcpBridgeArgs([
        '--endpoint',
        'http://127.0.0.1:8080/mcp',
        '--token',
        '  ',
      ], {}),
    ).toThrow('Missing MCP auth token (--token or LUDD_MCP_TOKEN).')

    await expect(mcpBridgeCommand([])).rejects.toThrow('Missing MCP endpoint URL')
  })
})
