export type LogFormat = 'text' | 'json'

export interface LogMetadata {
  readonly logKey: string
  readonly format: LogFormat
  readonly filePath?: string
  readonly totalLines?: number
  readonly totalItems?: number
  readonly propertyKey?: string
  readonly stepId?: string
  readonly attempt?: number
  readonly phase?: 'beforeStep' | 'afterStep'
  readonly guardrailIndex?: number
  readonly createdAt?: string
}

export interface ReadLogPageTextResult {
  readonly logKey: string
  readonly format: 'text'
  readonly lines: readonly string[]
  readonly page: number
  readonly pageSize: number
  readonly totalPages: number
  readonly totalLines: number
}

export interface ReadLogPageJsonResult {
  readonly logKey: string
  readonly format: 'json'
  readonly items: readonly unknown[]
  readonly page: number
  readonly pageSize: number
  readonly totalPages: number
  readonly totalItems: number
}

export type ReadLogPageResult = ReadLogPageTextResult | ReadLogPageJsonResult

export interface ReadLogLinesResult {
  readonly logKey: string
  readonly startLine: number
  readonly endLine: number
  readonly totalLines: number
  readonly lines: readonly string[]
}

export interface SearchLogMatch {
  readonly lineNumber: number
  readonly text: string
}

export interface SearchLogResult {
  readonly logKey: string
  readonly query: string
  readonly totalMatches: number
  readonly matches: readonly SearchLogMatch[]
}

export interface OffloadLogOptions {
  readonly stepId: string
  readonly attempt: number
  readonly phase: 'beforeStep' | 'afterStep'
  readonly guardrailIndex: number
  readonly content: string
  readonly format?: LogFormat
  readonly pagination?: string | { readonly key: string } | ((data: unknown) => readonly unknown[])
}

export interface LogStore {
  readonly runDir: string
  offload: (options: OffloadLogOptions) => Promise<LogMetadata>
  readPage: (logKey: string, page?: number, pageSize?: number) => Promise<ReadLogPageResult | null>
  readLines: (logKey: string, startLine: number, endLine: number) => Promise<ReadLogLinesResult | null>
  search: (logKey: string, query: string, maxMatches?: number) => Promise<SearchLogResult | null>
  getMetadata: (logKey: string) => Promise<LogMetadata | null>
  has: (logKey: string) => Promise<boolean>
}
