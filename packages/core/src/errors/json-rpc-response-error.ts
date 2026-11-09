export class JsonRpcResponseError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'JsonRpcResponseError'
    this.code = code
    this.data = data
  }
}
