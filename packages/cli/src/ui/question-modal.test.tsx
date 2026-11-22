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
})
