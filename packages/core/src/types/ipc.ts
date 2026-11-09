import type { RunStateSnapshot } from './state.js'

export const JSON_RPC_PARSE_ERROR = -32700
export const JSON_RPC_INVALID_REQUEST = -32600
export const JSON_RPC_METHOD_NOT_FOUND = -32601
export const JSON_RPC_INVALID_PARAMS = -32602
export const JSON_RPC_INTERNAL_ERROR = -32603

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: JSON_RPC_PARSE_ERROR,
  INVALID_REQUEST: JSON_RPC_INVALID_REQUEST,
  METHOD_NOT_FOUND: JSON_RPC_METHOD_NOT_FOUND,
  INVALID_PARAMS: JSON_RPC_INVALID_PARAMS,
  INTERNAL_ERROR: JSON_RPC_INTERNAL_ERROR,
} as const

export type JsonRpcId = string | number | null

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcSuccessResponse<T = unknown> {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: T
  error?: never
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  error: JsonRpcError
  result?: never
}

export type JsonRpcResponse<T = unknown> = JsonRpcSuccessResponse<T> | JsonRpcErrorResponse

export interface ControlRpcHandlers {
  getStatus: () => RunStateSnapshot | Promise<RunStateSnapshot>
  [method: string]: ((params: unknown) => unknown | Promise<unknown>) | undefined
}

export interface ControlServer {
  readonly socketPath: string
  readonly close: () => Promise<void>
}

export interface ControlClient {
  readonly socketPath: string
  readonly status: () => Promise<RunStateSnapshot>
  readonly request: <T = unknown>(method: string, params?: unknown) => Promise<T>
  readonly close: () => Promise<void>
}
