import { describe, expect, it } from 'vitest'
import { RunAlreadyExistsError } from './run-already-exists-error.js'

describe('runAlreadyExistsError', () => {
  it('identifies the existing run and explains how to resume it', () => {
    const error = new RunAlreadyExistsError('run-1')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('RunAlreadyExistsError')
    expect(error.runId).toBe('run-1')
    expect(error.message).toBe('Run "run-1" already exists. Use "ludd resume run-1" to resume it.')
  })
})
