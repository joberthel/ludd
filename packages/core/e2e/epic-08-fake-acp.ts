import type { AcpMcpBridgeConfig } from '@luddjs/agents'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const FAKE_ACP_SERVER_PATH = path.resolve(__dirname, 'epic-08-fake-acp-server.mjs')
export const CLI_BIN_PATH = path.resolve(__dirname, '../../cli/dist/bin.js')

export interface FakeAcpPermissionCheck {
  kind: string
  optionId: string
}

export interface FakeAcpMcpToolCall {
  name: string
  isError: boolean
  text: string
  listedTools: string[]
}

export interface FakeAcpRecord {
  sessionMethod: 'session/new' | 'session/load'
  sessionId: string
  cwd: string
  prompt: string
  mcpServerNames: string[]
  permissionChecks: FakeAcpPermissionCheck[]
  mcpToolCalls: FakeAcpMcpToolCall[]
}

export interface FakeAcpServerConfig {
  command: string
  args: string[]
  env: Record<string, string>
  mcpBridge: AcpMcpBridgeConfig
}

export interface FakeAcpFixture {
  agentConfig: FakeAcpServerConfig
  readRecords: () => FakeAcpRecord[]
}

/** Creates a deterministic Fake ACP Server fixture (hermetic CI, wired with `ludd mcp-bridge`). */
export function createFakeAcp(tempDir: string): FakeAcpFixture {
  if (!fs.existsSync(CLI_BIN_PATH)) {
    throw new Error(`CLI binary not found at ${CLI_BIN_PATH}. Run "pnpm build" first.`)
  }
  const stateFile = path.join(tempDir, 'fake-acp-state.json')
  const recordsFile = path.join(tempDir, 'fake-acp-records.jsonl')

  return {
    agentConfig: {
      command: process.execPath,
      args: [FAKE_ACP_SERVER_PATH],
      env: {
        EPIC08_ACP_STATE_FILE: stateFile,
        EPIC08_ACP_RECORDS_FILE: recordsFile,
      },
      mcpBridge: {
        command: process.execPath,
        args: [CLI_BIN_PATH, 'mcp-bridge'],
      },
    },
    readRecords: () => {
      if (!fs.existsSync(recordsFile)) {
        return []
      }
      return fs
        .readFileSync(recordsFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as FakeAcpRecord)
    },
  }
}
