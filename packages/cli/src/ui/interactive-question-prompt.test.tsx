import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { InteractiveQuestionPrompt, promptInteractiveQuestionInTty } from './interactive-question-prompt.js'

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
})
