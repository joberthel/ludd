#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import Pastel from 'pastel'
import { workerCommand } from './worker/worker-command.js'

export async function main(argv = process.argv): Promise<void> {
  if (argv[2] === '__worker') {
    await workerCommand(argv.slice(3))
    return
  }
  const app = new Pastel({
    importMeta: import.meta,
    name: 'ludd',
    description: 'Agentic workflow harness CLI',
  })
  await app.run(argv)
}

export async function runCli(argv = process.argv): Promise<void> {
  try {
    await main(argv)
  }
  catch (error: unknown) {
    console.error(error instanceof Error
      ? error.message
      : String(error))
    process.exitCode = 1
  }
}

function resolveRealPath(target: string): string {
  try {
    return fs.realpathSync(target)
  }
  catch {
    return path.resolve(target)
  }
}

export async function bootstrapCli(entrypoint = process.argv[1]): Promise<void> {
  if (entrypoint && resolveRealPath(entrypoint) === resolveRealPath(fileURLToPath(import.meta.url)))
    await runCli()
}

void bootstrapCli()
