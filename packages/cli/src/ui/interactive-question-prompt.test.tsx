import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { InteractiveQuestionPrompt, promptInteractiveQuestionInTty } from './interactive-question-prompt.js'

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*m/g, '')
}

describe('interactiveQuestionPrompt', () => {
  it('renders and submits text, number (with validation), confirm, select, and multi-select controls', async () => {
    const onText = vi.fn()
    const text = render(
      <InteractiveQuestionPrompt
        question={{
          type: 'text',
          prompt: 'Your name?',
          default: 'Ada',
          placeholder: 'Enter name',
        }}
        onSubmit={onText}
      />,
    )
    expect(text.lastFrame()).toContain('Your name?')
    text.stdin.write('\r')
    await vi.waitFor(() => expect(onText).toHaveBeenCalledWith('Ada'))
    text.unmount()

    const onNumber = vi.fn()
    const num = render(
      <InteractiveQuestionPrompt
        question={{
          type: 'number',
          prompt: 'Pick 1..5',
          min: 1,
          max: 5,
        }}
        onSubmit={onNumber}
      />,
    )
    num.stdin.write('9')
    await vi.waitFor(() => expect(num.lastFrame()).toContain('9'))
    num.stdin.write('\r')
    await vi.waitFor(() => expect(num.lastFrame()).toContain('at most 5'))
    expect(onNumber).not.toHaveBeenCalled()
    num.unmount()

    const onNumberDefault = vi.fn()
    const num2 = render(
      <InteractiveQuestionPrompt
        question={{ type: 'number', prompt: 'Default num', default: 3 }}
        onSubmit={onNumberDefault}
      />,
    )
    num2.stdin.write('\r')
    await vi.waitFor(() => expect(onNumberDefault).toHaveBeenCalledWith(3))
    num2.unmount()

    const onConfirm = vi.fn()
    const conf = render(
      <InteractiveQuestionPrompt
        question={{ type: 'confirm', prompt: 'Proceed?', default: false }}
        onSubmit={onConfirm}
      />,
    )
    conf.stdin.write('y')
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledWith(true))
    conf.unmount()

    const onCancel = vi.fn()
    const conf2 = render(
      <InteractiveQuestionPrompt
        question={{ type: 'confirm', prompt: 'Cancel?' }}
        onSubmit={onCancel}
      />,
    )
    conf2.stdin.write('n')
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledWith(false))
    conf2.unmount()

    const onSelect = vi.fn()
    const sel = render(
      <InteractiveQuestionPrompt
        question={{
          type: 'select',
          prompt: 'Choose one',
          options: ['alpha', 'beta'],
          default: 'alpha',
        }}
        onSubmit={onSelect}
      />,
    )
    sel.stdin.write('\r')
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith('alpha'))
    sel.unmount()

    const onSelectNoDef = vi.fn()
    const sel2 = render(
      <InteractiveQuestionPrompt
        question={{
          type: 'select',
          prompt: 'No default',
          options: ['alpha', 'beta'],
        }}
        onSubmit={onSelectNoDef}
      />,
    )
    sel2.stdin.write('\r')
    await vi.waitFor(() => expect(onSelectNoDef).toHaveBeenCalledWith('alpha'))
    sel2.unmount()

    const onMulti = vi.fn()
    const multi = render(
      <InteractiveQuestionPrompt
        question={{
          type: 'multi-select',
          prompt: 'Choose many',
          options: ['x', 'y'],
          default: ['x'],
        }}
        onSubmit={onMulti}
      />,
    )
    multi.stdin.write('\r')
    await vi.waitFor(() => expect(onMulti).toHaveBeenCalledWith(['x']))
    multi.unmount()

    const onMultiNoDef = vi.fn()
    const multi2 = render(
      <InteractiveQuestionPrompt
        question={{
          type: 'multi-select',
          prompt: 'Multi no def',
          options: ['x', 'y'],
        }}
        onSubmit={onMultiNoDef}
      />,
    )
    multi2.stdin.write('\r')
    await vi.waitFor(() => expect(onMultiNoDef).toHaveBeenCalledWith([]))
    multi2.unmount()
  })

  it('resolves on submit and aborts cleanly via AbortSignal in promptInteractiveQuestionInTty', async () => {
    let instance!: ReturnType<typeof render>
    const answerPromise = promptInteractiveQuestionInTty(
      { type: 'text', prompt: 'Live?', default: 'yes' },
      undefined,
      (el) => {
        instance = render(el)
        return instance
      },
    )
    instance.stdin.write('\r')
    await expect(answerPromise).resolves.toBe('yes')

    const controller = new AbortController()
    controller.abort()
    await expect(promptInteractiveQuestionInTty({ type: 'text', prompt: 'Q?' }, controller.signal))
      .rejects
      .toMatchObject({ name: 'AbortError' })

    const liveController = new AbortController()
    const pending = promptInteractiveQuestionInTty({ type: 'text', prompt: 'Q?' }, liveController.signal)
    liveController.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('ignores keystrokes when isDisabled is true and ignores Ctrl+B in text and number inputs', async () => {
    const onText = vi.fn()
    const disabledText = render(
      <InteractiveQuestionPrompt
        question={{ type: 'text', prompt: 'Disabled?', default: 'keep' }}
        isDisabled={true}
        onSubmit={onText}
      />,
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    disabledText.stdin.write('extra')
    disabledText.stdin.write('\r')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onText).not.toHaveBeenCalled()
    expect(disabledText.lastFrame()).toContain('keep')
    expect(disabledText.lastFrame()).not.toContain('extra')
    disabledText.unmount()

    const disabledEmptyPlaceholder = render(
      <InteractiveQuestionPrompt
        question={{ type: 'text', prompt: 'Disabled empty?', placeholder: 'Type here' }}
        isDisabled={true}
        onSubmit={onText}
      />,
    )
    expect(disabledEmptyPlaceholder.lastFrame()).toContain('Type here')
    disabledEmptyPlaceholder.unmount()

    const disabledEmptyNoPlaceholder = render(
      <InteractiveQuestionPrompt
        question={{ type: 'text', prompt: 'Disabled bare?' }}
        isDisabled={true}
        onSubmit={onText}
      />,
    )
    expect(disabledEmptyNoPlaceholder.lastFrame()).toContain('Disabled bare?')
    disabledEmptyNoPlaceholder.unmount()

    const onTextActive = vi.fn()
    const activeText = render(
      <InteractiveQuestionPrompt
        question={{ type: 'text', prompt: 'Active text?' }}
        isDisabled={false}
        onSubmit={onTextActive}
      />,
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    // Backspace at cursorOffset 0 is a no-op; upArrow, escape, and pageDown are ignored
    activeText.stdin.write('\x7F')
    activeText.stdin.write('\x1B[A')
    activeText.stdin.write('\x1B')
    await new Promise(resolve => setTimeout(resolve, 60))
    activeText.stdin.write('\x1B[6~')
    await new Promise(resolve => setTimeout(resolve, 20))
    activeText.stdin.write('abc')
    await vi.waitFor(() => expect(activeText.lastFrame()).toContain('abc'))
    // Ctrl+B must not insert 'b'
    activeText.stdin.write('\x02')
    // Left arrow, backspace, right arrow, insert
    activeText.stdin.write('\x1B[D')
    activeText.stdin.write('\x7F')
    activeText.stdin.write('\x1B[C')
    activeText.stdin.write('d')
    await new Promise(resolve => setTimeout(resolve, 20))
    activeText.stdin.write('\r')
    await vi.waitFor(() => expect(onTextActive).toHaveBeenCalledWith('acd'))
    activeText.unmount()

    const onNumberActive = vi.fn()
    const activeNumber = render(
      <InteractiveQuestionPrompt
        question={{ type: 'number', prompt: 'Active number?' }}
        isDisabled={false}
        onSubmit={onNumberActive}
      />,
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    activeNumber.stdin.write('42')
    activeNumber.stdin.write('\x02')
    await new Promise(resolve => setTimeout(resolve, 20))
    activeNumber.stdin.write('\r')
    await vi.waitFor(() => expect(onNumberActive).toHaveBeenCalledWith(42))
    activeNumber.unmount()
  })

  it('renders a single empty line between the question prompt and the answer control', () => {
    const text = render(
      <InteractiveQuestionPrompt
        question={{
          type: 'text',
          prompt: 'Your name?',
          default: 'Ada',
        }}
        onSubmit={vi.fn()}
      />,
    )
    const textLines = stripAnsi(text.lastFrame() ?? '').split('\n')
    const textPromptIdx = textLines.findIndex(line => line.includes('Your name?'))
    expect(textPromptIdx).toBeGreaterThanOrEqual(0)
    expect(textLines[textPromptIdx + 1]?.trim()).toBe('')
    expect(textLines[textPromptIdx + 2]).toContain('Ada')
    text.unmount()

    const select = render(
      <InteractiveQuestionPrompt
        question={{
          type: 'select',
          prompt: 'Choose one',
          options: ['alpha', 'beta'],
        }}
        onSubmit={vi.fn()}
      />,
    )
    const selectLines = stripAnsi(select.lastFrame() ?? '').split('\n')
    const selectPromptIdx = selectLines.findIndex(line => line.includes('Choose one'))
    expect(selectPromptIdx).toBeGreaterThanOrEqual(0)
    expect(selectLines[selectPromptIdx + 1]?.trim()).toBe('')
    expect(selectLines[selectPromptIdx + 2]).toContain('alpha')
    select.unmount()
  })

  it('supports Other option in select when allowOther is true, validates empty input, and supports Esc to go back', async () => {
    const onSelect = vi.fn()
    const sel = render(
      <InteractiveQuestionPrompt
        question={{
          type: 'select',
          prompt: 'Pick approach',
          options: ['fast', 'safe'],
          allowOther: true,
        }}
        onSubmit={onSelect}
      />,
    )
    expect(sel.lastFrame()).toContain('Other')

    await new Promise(resolve => setTimeout(resolve, 20))
    // Navigate past 'fast' and 'safe' to 'Other'
    sel.stdin.write('\x1B[B')
    sel.stdin.write('\x1B[B')
    await new Promise(resolve => setTimeout(resolve, 20))
    sel.stdin.write('\r')
    await vi.waitFor(() => {
      expect(sel.lastFrame()).toContain('Type your answer...')
      expect(sel.lastFrame()).toContain('Enter to submit, Esc to go back')
    })
    await new Promise(resolve => setTimeout(resolve, 20))

    // Empty/whitespace submission shows error and does not submit
    sel.stdin.write('   ')
    await new Promise(resolve => setTimeout(resolve, 20))
    sel.stdin.write('\r')
    await vi.waitFor(() => {
      expect(sel.lastFrame()).toContain('Expected a non-empty answer.')
    })
    expect(onSelect).not.toHaveBeenCalled()

    // Esc returns to the select list and clears error
    sel.stdin.write('\x1B')
    await vi.waitFor(() => {
      expect(sel.lastFrame()).toContain('fast')
      expect(sel.lastFrame()).toContain('Other')
      expect(sel.lastFrame()).not.toContain('Expected a non-empty answer.')
    })

    // Navigate to Other again and submit custom text
    sel.stdin.write('\x1B[B')
    sel.stdin.write('\x1B[B')
    await new Promise(resolve => setTimeout(resolve, 20))
    sel.stdin.write('\r')
    await vi.waitFor(() => {
      expect(sel.lastFrame()).toContain('Type your answer...')
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    sel.stdin.write('hybrid approach')
    await vi.waitFor(() => {
      expect(sel.lastFrame()).toContain('hybrid approach')
    })
    sel.stdin.write('\r')
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith('hybrid approach'))
    sel.unmount()
  })

  it('does not render Other when allowOther is false or omitted, and avoids sentinel collisions', async () => {
    const withoutAllowOther = render(
      <InteractiveQuestionPrompt
        question={{
          type: 'select',
          prompt: 'Omitted',
          options: ['a', 'b'],
        }}
        onSubmit={vi.fn()}
      />,
    )
    expect(withoutAllowOther.lastFrame()).not.toContain('Other')
    withoutAllowOther.unmount()

    const withFalse = render(
      <InteractiveQuestionPrompt
        question={{
          type: 'select',
          prompt: 'Disabled other',
          options: ['a', 'b'],
          allowOther: false,
        }}
        onSubmit={vi.fn()}
      />,
    )
    expect(withFalse.lastFrame()).not.toContain('Other')
    withFalse.unmount()

    // Collision safety: options already contain '__ludd_other__' and 'other'
    const onCollision = vi.fn()
    const collision = render(
      <InteractiveQuestionPrompt
        question={{
          type: 'select',
          prompt: 'Collision check',
          options: [
            { label: 'Literal sentinel', value: '__ludd_other__' },
            { label: 'Lowercase other', value: 'other' },
          ],
          allowOther: true,
        }}
        onSubmit={onCollision}
      />,
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    // Selecting first option ('__ludd_other__') submits it directly instead of entering Other mode
    collision.stdin.write('\r')
    await vi.waitFor(() => expect(onCollision).toHaveBeenCalledWith('__ludd_other__'))
    collision.unmount()
  })

  it('ignores typing and Escape in Other text mode when isDisabled is true', async () => {
    const onSelect = vi.fn()
    const props = {
      question: {
        type: 'select' as const,
        prompt: 'Disabled other input',
        options: ['a'],
        allowOther: true,
      },
      onSubmit: onSelect,
    }
    const sel = render(<InteractiveQuestionPrompt {...props} isDisabled={false} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    sel.stdin.write('\x1B[B')
    await new Promise(resolve => setTimeout(resolve, 20))
    sel.stdin.write('\r')
    await vi.waitFor(() => {
      expect(sel.lastFrame()).toContain('Type your answer...')
    })

    sel.rerender(<InteractiveQuestionPrompt {...props} isDisabled={true} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    sel.stdin.write('ignored')
    sel.stdin.write('\x1B')
    sel.stdin.write('\r')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onSelect).not.toHaveBeenCalled()
    expect(sel.lastFrame()).toContain('Type your answer...')
    expect(sel.lastFrame()).not.toContain('ignored')
    sel.unmount()
  })
})
