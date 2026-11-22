import type { ActiveTtyPrompt } from './interactive-question-prompt.js'
import { Box, Text, useInput } from 'ink'
import { render } from 'ink-testing-library'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { QuestionModal } from './question-modal.js'

function ModalHarness({
  prompt,
  onSubmit,
}: {
  prompt: ActiveTtyPrompt
  onSubmit: (answer: unknown) => void
}) {
  const [minimized, setMinimized] = useState(false)
  useInput((input, key) => {
    if (key.ctrl && input === 'b') {
      setMinimized(prev => !prev)
    }
  })

  return (
    <Box position="relative" width={80} height={20} flexDirection="column">
      <Text>Background logs: build succeeded</Text>
      <Box flexGrow={1} alignItems="center" justifyContent="center">
        <Text>OVERLAPPING_BACKGROUND_CONTENT</Text>
      </Box>
      <QuestionModal
        prompt={prompt}
        contextLabel="implement › afterStep"
        minimized={minimized}
        width={80}
        onSubmit={onSubmit}
      />
    </Box>
  )
}

describe('questionModal', () => {
  it('renders modal overlay, toggles minimize with Ctrl+B, and submits answer', async () => {
    const onSubmit = vi.fn()
    const prompt: ActiveTtyPrompt = {
      question: {
        type: 'text',
        prompt: 'Approve deployment?',
        default: 'yes',
      },
      onSubmit,
    }

    const { lastFrame, stdin, unmount } = render(
      <ModalHarness prompt={prompt} onSubmit={onSubmit} />,
    )

    expect(lastFrame()).toContain('Input Required')
    expect(lastFrame()).toContain('implement › afterStep')
    expect(lastFrame()).toContain('Approve deployment?')
    expect(lastFrame()).toContain('Background logs: build succeeded')
    expect(lastFrame()).not.toContain('OVERLAPPING_BACKGROUND_CONTENT')
    // Uses terminal default background instead of forcing ANSI black background (\x1B[40m)
    expect(lastFrame()).not.toContain('\x1B[40m')

    await new Promise(resolve => setTimeout(resolve, 20))
    // Minimize via Ctrl+B (\x02)
    stdin.write('\x02')
    await vi.waitFor(() => {
      expect(lastFrame()).not.toContain('Approve deployment?')
      expect(lastFrame()).toContain('Background logs: build succeeded')
      expect(lastFrame()).toContain('OVERLAPPING_BACKGROUND_CONTENT')
    })

    // Restore via Ctrl+B (\x02)
    stdin.write('\x02')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Approve deployment?')
      expect(lastFrame()).not.toContain('OVERLAPPING_BACKGROUND_CONTENT')
    })

    // Submit default answer
    stdin.write('\r')
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('yes')
    })
    unmount()

    const bare = render(
      <Box width={80} height={20}>
        <QuestionModal
          prompt={prompt}
          minimized={false}
          onSubmit={onSubmit}
        />
      </Box>,
    )
    expect(bare.lastFrame()).toContain('Input Required')
    bare.unmount()
  })

  it('preserves partial text input across Ctrl+B minimize/restore without inserting b or accepting background keys', async () => {
    const onSubmit = vi.fn()
    const prompt: ActiveTtyPrompt = {
      question: {
        type: 'text',
        prompt: 'Release notes?',
        placeholder: 'Enter notes',
      },
      onSubmit,
    }

    const { lastFrame, stdin, unmount } = render(
      <ModalHarness prompt={prompt} onSubmit={onSubmit} />,
    )

    await new Promise(resolve => setTimeout(resolve, 20))
    stdin.write('hello')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('hello')
    })

    // Minimize via Ctrl+B (\x02)
    stdin.write('\x02')
    await vi.waitFor(() => {
      expect(lastFrame()).not.toContain('Release notes?')
      expect(lastFrame()).toContain('OVERLAPPING_BACKGROUND_CONTENT')
    })

    // Keys sent while minimized must not mutate input or submit
    stdin.write('xyz')
    stdin.write('\r')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onSubmit).not.toHaveBeenCalled()

    // Restore via Ctrl+B (\x02)
    stdin.write('\x02')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Release notes?')
      expect(lastFrame()).toContain('hello')
      expect(lastFrame()).not.toContain('hellob')
      expect(lastFrame()).not.toContain('xyz')
    })

    stdin.write(' world')
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('hello world')
    })

    stdin.write('\r')
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('hello world')
    })
    unmount()
  })

  it('preserves select, multi-select, and number validation error state across Ctrl+B minimize/restore', async () => {
    // Select state preserved
    const onSelect = vi.fn()
    const selectPrompt: ActiveTtyPrompt = {
      question: {
        type: 'select',
        prompt: 'Pick environment',
        options: ['dev', 'staging', 'prod'],
      },
      onSubmit: onSelect,
    }

    const sel = render(<ModalHarness prompt={selectPrompt} onSubmit={onSelect} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    // Down arrow (\x1B[B) moves selection from dev -> staging
    sel.stdin.write('\x1B[B')
    await new Promise(resolve => setTimeout(resolve, 20))

    sel.stdin.write('\x02')
    await vi.waitFor(() => {
      expect(sel.lastFrame()).not.toContain('Pick environment')
    })
    sel.stdin.write('\x1B[B')
    sel.stdin.write('\r')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onSelect).not.toHaveBeenCalled()

    sel.stdin.write('\x02')
    await vi.waitFor(() => {
      expect(sel.lastFrame()).toContain('Pick environment')
    })
    sel.stdin.write('\r')
    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith('staging')
    })
    sel.unmount()

    // Multi-select state preserved
    const onMulti = vi.fn()
    const multiPrompt: ActiveTtyPrompt = {
      question: {
        type: 'multi-select',
        prompt: 'Pick targets',
        options: ['web', 'api'],
      },
      onSubmit: onMulti,
    }

    const multi = render(<ModalHarness prompt={multiPrompt} onSubmit={onMulti} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    // Space toggles 'web'
    multi.stdin.write(' ')
    await new Promise(resolve => setTimeout(resolve, 20))

    multi.stdin.write('\x02')
    await vi.waitFor(() => {
      expect(multi.lastFrame()).not.toContain('Pick targets')
    })
    multi.stdin.write('\r')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onMulti).not.toHaveBeenCalled()

    multi.stdin.write('\x02')
    await vi.waitFor(() => {
      expect(multi.lastFrame()).toContain('Pick targets')
    })
    multi.stdin.write('\r')
    await vi.waitFor(() => {
      expect(onMulti).toHaveBeenCalledWith(['web'])
    })
    multi.unmount()

    // Number validation error state preserved
    const onNumber = vi.fn()
    const numberPrompt: ActiveTtyPrompt = {
      question: {
        type: 'number',
        prompt: 'Pick 1..5',
        min: 1,
        max: 5,
      },
      onSubmit: onNumber,
    }

    const num = render(<ModalHarness prompt={numberPrompt} onSubmit={onNumber} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    num.stdin.write('9')
    await vi.waitFor(() => {
      expect(num.lastFrame()).toContain('9')
    })
    num.stdin.write('\r')
    await vi.waitFor(() => {
      expect(num.lastFrame()).toContain('at most 5')
    })
    expect(onNumber).not.toHaveBeenCalled()

    num.stdin.write('\x02')
    await vi.waitFor(() => {
      expect(num.lastFrame()).not.toContain('Pick 1..5')
    })

    num.stdin.write('\x02')
    await vi.waitFor(() => {
      expect(num.lastFrame()).toContain('Pick 1..5')
      expect(num.lastFrame()).toContain('at most 5')
      expect(num.lastFrame()).toContain('9')
    })
    num.unmount()
  })
})
