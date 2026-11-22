import type { ParseArgsConfig } from 'node:util'
import { parseArgs } from 'node:util'

export interface ParsedArgs {
  values: Record<string, string | boolean | string[] | undefined>
  positionals: string[]
}

export function parse(args: string[], options: ParseArgsConfig['options']): ParsedArgs {
  return parseArgs({
    args,
    options,
    allowPositionals: true,
    strict: true,
  })
}

export function text(values: ParsedArgs['values'], name: string): string | undefined {
  const value = values[name]
  return typeof value === 'string'
    ? value
    : undefined
}

export function flag(values: ParsedArgs['values'], name: string): boolean {
  return values[name] === true
}
