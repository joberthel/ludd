import process from 'node:process'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { FullscreenContainer } from './fullscreen-container.js'

describe('fullscreenContainer component', () => {
  it('switches to alternate screen on mount and restores standard screen on unmount when enabled', () => {
    const written: string[] = []
    const mockStdout = {
      isTTY: true,
      write: vi.fn((data: string) => {
        written.push(data)
        return true
      }),
    } as unknown as NodeJS.WriteStream

    const { unmount } = render(
      <FullscreenContainer disabled={false} stdout={mockStdout}>
        <Text>Content inside fullscreen</Text>
      </FullscreenContainer>,
    )

    expect(written).toContain('\x1B[?1049h\x1B[H')
    expect(written).not.toContain('\x1B[?1049l\x1B[?25h')

    unmount()

    expect(written).toContain('\x1B[?1049l\x1B[?25h')
  })

  it('registers exit listener and unregisters it on unmount', () => {
    const onSpy = vi.spyOn(process, 'on')
    const offSpy = vi.spyOn(process, 'off')

    const mockStdout = {
      isTTY: true,
      write: vi.fn(),
    } as unknown as NodeJS.WriteStream

    const { unmount } = render(
      <FullscreenContainer disabled={false} stdout={mockStdout}>
        <Text>Listening</Text>
      </FullscreenContainer>,
    )

    expect(onSpy).toHaveBeenCalledWith('exit', expect.any(Function))

    unmount()

    expect(offSpy).toHaveBeenCalledWith('exit', expect.any(Function))

    onSpy.mockRestore()
    offSpy.mockRestore()
  })

  it('renders children gracefully in non-TTY or disabled environments without throwing', () => {
    const written: string[] = []
    const mockStdout = {
      isTTY: false,
      write: vi.fn((data: string) => {
        written.push(data)
        return true
      }),
    } as unknown as NodeJS.WriteStream

    const { lastFrame, unmount } = render(
      <FullscreenContainer disabled stdout={mockStdout}>
        <Text>Disabled Fullscreen Content</Text>
      </FullscreenContainer>,
    )

    expect(lastFrame()).toContain('Disabled Fullscreen Content')
    expect(written).toHaveLength(0)

    unmount()
    expect(written).toHaveLength(0)
  })

  it('renders children with default window dimensions fallback', () => {
    const { lastFrame } = render(
      <FullscreenContainer>
        <Text>Safe child</Text>
      </FullscreenContainer>,
    )

    expect(lastFrame()).toContain('Safe child')
  })
})
