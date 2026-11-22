import type { z } from 'zod'
import type { InteractiveQuestion } from './interactive.js'

export interface ArtifactClient {
  put: (key: string, content: string) => Promise<void>
  get: (key: string) => Promise<string | null>
  getJson: <T = unknown>(key: string) => Promise<T | null>
  has: (key: string) => Promise<boolean>
  list?: () => Promise<string[]>
}

export type AskUserHandler = (question: InteractiveQuestion) => Promise<unknown>

export interface EmbeddedMcpServer {
  readonly url: string
  readonly port: number
  readonly authToken: string
  setAskUserHandler?: (handler: AskUserHandler | undefined) => void
  close: () => Promise<void>
}

export interface ArtifactValidationRule<TSchema extends z.ZodType = z.ZodType> {
  nonEmpty?: boolean
  schema?: TSchema
  validate?: (content: string) => boolean | Promise<boolean>
}

export interface ArtifactValidationIssue {
  artifactKey: string
  message: string
  path?: readonly (string | number | symbol)[]
}
