function formatDefaultMessage(
  expectedVersion: number,
  actualVersion: unknown,
  sourcePath: string,
): string {
  const actualDisplay = actualVersion === undefined
    ? 'undefined'
    : JSON.stringify(actualVersion)
  return `Schema version mismatch in "${sourcePath}": expected version ${expectedVersion}, but found ${actualDisplay}.`
}

export class SchemaVersionMismatchError extends Error {
  readonly expectedVersion: number
  readonly actualVersion: unknown
  readonly sourcePath: string

  constructor(
    expectedVersion: number,
    actualVersion: unknown,
    sourcePath: string,
    message?: string,
  ) {
    super(message ?? formatDefaultMessage(expectedVersion, actualVersion, sourcePath))
    this.name = 'SchemaVersionMismatchError'
    this.expectedVersion = expectedVersion
    this.actualVersion = actualVersion
    this.sourcePath = sourcePath
  }
}
