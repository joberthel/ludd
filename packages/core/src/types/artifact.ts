export interface ArtifactClient {
  put: (key: string, content: string) => Promise<void>
  get: (key: string) => Promise<string | null>
  getJson: <T = unknown>(key: string) => Promise<T | null>
  has: (key: string) => Promise<boolean>
}

export interface EmbeddedMcpServer {
  readonly url: string
  readonly port: number
  readonly authToken: string
  close: () => Promise<void>
}
