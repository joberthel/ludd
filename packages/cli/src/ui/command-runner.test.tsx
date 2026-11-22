import process from 'node:process'
import { render } from 'ink-testing-library'
import { afterEach, expect, it, vi } from 'vitest'
import { CommandRunner } from './command-runner.js'

const originalExitCode = process.exitCode

afterEach(() => {
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
})

it('renders a spinner while running and sets exitCode on success', async () => {
  let resolveRun!: (code: number) => void
  const execute = vi.fn(async () => new Promise<number>((resolve) => {
    resolveRun = resolve
  }))
  const { lastFrame, unmount } = render(
    <CommandRunner execute={execute} spinnerLabel="Working..." />,
  )
  expect(lastFrame()).toContain('Working...')
  resolveRun(0)
  await vi.waitFor(() => expect(process.exitCode).toBe(0))
  unmount()
})

it('renders an error StatusMessage and logs to stderr when execute rejects with an Error or string', async () => {
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { lastFrame, unmount } = render(
    <CommandRunner execute={async () => Promise.reject(new Error('boom'))} />,
  )
  await vi.waitFor(() => expect(lastFrame()).toContain('boom'))
  expect(process.exitCode).toBe(1)
  expect(errSpy).toHaveBeenCalledWith('boom')
  unmount()

  const third = render(
    <CommandRunner execute={vi.fn().mockRejectedValue('raw failure')} />,
  )
  await vi.waitFor(() => expect(third.lastFrame()).toContain('raw failure'))
  expect(errSpy).toHaveBeenCalledWith('raw failure')
  third.unmount()
})

it('ignores late resolution or rejection after unmount', async () => {
  let resolveRun!: (code: number) => void
  const first = render(
    <CommandRunner
      execute={async () => new Promise<number>((resolve) => {
        resolveRun = resolve
      })}
    />,
  )
  process.exitCode = undefined
  first.unmount()
  resolveRun(1)
  await Promise.resolve()
  expect(process.exitCode).toBeUndefined()

  let rejectRun!: (err: Error) => void
  const second = render(
    <CommandRunner
      execute={async () => new Promise<number>((_, reject) => {
        rejectRun = reject
      })}
    />,
  )
  second.unmount()
  rejectRun(new Error('late'))
  await Promise.resolve()
  expect(process.exitCode).toBeUndefined()
})
