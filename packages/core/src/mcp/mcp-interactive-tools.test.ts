import { describe, expect, it, vi } from 'vitest'
import { ASK_USER_TOOL_NAME, executeAskUserToolCall, MCP_INTERACTIVE_TOOLS_LIST } from './mcp-interactive-tools.js'
import { executeToolCall, handleToolsList } from './mcp-tools.js'

describe('mcp interactive ask_user tool', () => {
  it('includes ask_user in tools/list only when interactive is enabled', () => {
    const withoutInteractive = handleToolsList(1) as { result: { tools: Array<{ name: string }> } }
    expect(withoutInteractive.result.tools.map(t => t.name)).not.toContain(ASK_USER_TOOL_NAME)

    const withInteractive = handleToolsList(2, true) as { result: { tools: Array<{ name: string }> } }
    expect(withInteractive.result.tools.map(t => t.name)).toContain(ASK_USER_TOOL_NAME)
    expect(MCP_INTERACTIVE_TOOLS_LIST[0]?.inputSchema.properties).toHaveProperty('allowOther')
  })

  it('defaults allowOther to true for select, honors explicit boolean, and rejects non-boolean allowOther', async () => {
    const handler = vi.fn(async () => 'custom')

    await executeAskUserToolCall({
      type: 'select',
      prompt: 'Pick one',
      options: ['a', 'b'],
    }, handler)
    expect(handler).toHaveBeenLastCalledWith({
      type: 'select',
      prompt: 'Pick one',
      options: ['a', 'b'],
      allowOther: true,
    })

    await executeAskUserToolCall({
      type: 'select',
      prompt: 'Pick one',
      options: ['a', 'b'],
      allowOther: false,
    }, handler)
    expect(handler).toHaveBeenLastCalledWith({
      type: 'select',
      prompt: 'Pick one',
      options: ['a', 'b'],
      allowOther: false,
    })

    await executeAskUserToolCall({
      type: 'select',
      prompt: 'Pick one',
      options: ['a', 'b'],
      allowOther: true,
    }, handler)
    expect(handler).toHaveBeenLastCalledWith({
      type: 'select',
      prompt: 'Pick one',
      options: ['a', 'b'],
      allowOther: true,
    })

    handler.mockClear()
    const invalid = await executeAskUserToolCall({
      type: 'select',
      prompt: 'Pick one',
      options: ['a', 'b'],
      allowOther: 'yes',
    }, handler)
    expect(invalid.isError).toBe(true)
    expect(invalid.content[0]?.text).toContain('allowOther')
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects calls when interactive mode is not enabled', async () => {
    const res = await executeAskUserToolCall({ type: 'text', prompt: 'Name?' }, undefined)
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('not enabled')
  })

  it('validates prompt, type, and select options', async () => {
    const handler = vi.fn(async () => 'ok')
    expect((await executeAskUserToolCall({ type: 'text', prompt: '  ' }, handler)).isError).toBe(true)
    expect((await executeAskUserToolCall({ type: 'bogus', prompt: 'Q?' }, handler)).isError).toBe(true)
    expect((await executeAskUserToolCall({ type: 'select', prompt: 'Pick', options: [] }, handler)).isError).toBe(true)
    expect((await executeAskUserToolCall({
      type: 'select',
      prompt: 'Pick',
      options: [123],
    }, handler)).isError).toBe(true)
    expect((await executeAskUserToolCall({ type: 'multi-select', prompt: 'Pick' }, handler)).isError).toBe(true)
    expect(handler).not.toHaveBeenCalled()
  })

  it('parses all five question types and formats string and non-string answers', async () => {
    const handler = vi.fn()
      .mockResolvedValueOnce('Alice')
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce('b')
      .mockResolvedValueOnce(['x', 'y'])

    const r1 = await executeAskUserToolCall({
      type: 'text',
      prompt: 'Name?',
      default: 'Bob',
      placeholder: 'name',
    }, handler)
    expect(r1).toEqual({
      content: [
        { type: 'text', text: 'Alice' },
      ],
    })

    const r2 = await executeAskUserToolCall({
      type: 'number',
      prompt: 'Count?',
      min: 1,
      max: 10,
      default: 5,
    }, handler)
    expect(r2).toEqual({
      content: [
        { type: 'text', text: '7' },
      ],
    })

    const r3 = await executeAskUserToolCall({ type: 'confirm', prompt: 'Continue?', default: false }, handler)
    expect(r3).toEqual({
      content: [
        { type: 'text', text: 'true' },
      ],
    })

    const r4 = await executeAskUserToolCall({
      type: 'select',
      prompt: 'Pick one',
      options: [
        'a',
        { label: 'Option B', value: 'b' },
      ],
      default: 'a',
    }, handler)
    expect(r4).toEqual({
      content: [
        { type: 'text', text: 'b' },
      ],
    })

    const r5 = await executeAskUserToolCall({
      type: 'multi-select',
      prompt: 'Pick many',
      options: ['x', 'y'],
      default: ['x'],
    }, handler)
    expect(r5).toEqual({
      content: [
        { type: 'text', text: '["x","y"]' },
      ],
    })

    // Also test minimal args without optional defaults and routing through executeToolCall
    const store = {} as never
    const minimalHandler = vi.fn(async () => 'done')
    const r6 = await executeToolCall(ASK_USER_TOOL_NAME, { type: 'text', prompt: 'Plain?' }, store, undefined, minimalHandler)
    expect(r6).toEqual({
      content: [
        { type: 'text', text: 'done' },
      ],
    })
    await executeAskUserToolCall({ type: 'number', prompt: 'N?' }, minimalHandler)
    await executeAskUserToolCall({ type: 'confirm', prompt: 'C?' }, minimalHandler)
    await executeAskUserToolCall({
      type: 'select',
      prompt: 'S?',
      options: ['a'],
    }, minimalHandler)
    await executeAskUserToolCall({
      type: 'multi-select',
      prompt: 'M?',
      options: ['a'],
      default: [1],
    }, minimalHandler)
  })

  it('converts handler errors into MCP tool error results', async () => {
    const r1 = await executeAskUserToolCall({ type: 'text', prompt: 'Q?' }, async () => {
      throw new Error('budget exhausted')
    })
    expect(r1).toEqual({
      content: [
        { type: 'text', text: 'budget exhausted' },
      ],
      isError: true,
    })

    const r2 = await executeAskUserToolCall({ type: 'text', prompt: 'Q?' }, async () => {
      throw 'raw error' // eslint-disable-line no-throw-literal
    })
    expect(r2).toEqual({
      content: [
        { type: 'text', text: 'raw error' },
      ],
      isError: true,
    })
  })
})
