export interface HarnessConfigLoadErrorOptions extends ErrorOptions {
  cause?: unknown
}

export class HarnessConfigLoadError extends Error {
  readonly configPath: string

  constructor(
    message: string,
    configPath: string,
    options?: HarnessConfigLoadErrorOptions,
  ) {
    super(message, options)
    this.name = 'HarnessConfigLoadError'
    this.configPath = configPath
  }
}
