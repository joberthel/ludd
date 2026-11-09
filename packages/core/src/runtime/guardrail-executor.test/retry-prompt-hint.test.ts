import { describe, expect, it } from 'vitest'
import { formatGuardrailRetryPrompt } from '../guardrail-retry-prompt.js'

describe('formatGuardrailRetryPrompt hint formatting', () => {
  it('formats prompt with user hint and offloaded MCP logKey', () => {
    const prompt = formatGuardrailRetryPrompt(
      'Write feature',
      0,
      { status: 'fail', body: 'Jest failed', logKey: 'log-123' },
      'http://localhost:4000',
      'Fix the mock clock in DateServiceTest',
    )
    expect(prompt).toContain('The step failed afterStep guardrail #0.\nSummary: Jest failed')
    expect(prompt).toContain('User hint:\nFix the mock clock in DateServiceTest')
    expect(prompt).toContain('Detailed failure log has been offloaded to MCP logKey "log-123" at http://localhost:4000.')
    expect(prompt).toContain('Original instruction:\nWrite feature')
  })

  it('formats prompt with user hint without MCP logKey', () => {
    const prompt = formatGuardrailRetryPrompt(
      'Write feature',
      1,
      { status: 'fail', body: 'Compile error' },
      undefined,
      'Check DateService types',
    )
    expect(prompt).toContain('The step failed afterStep guardrail #1.\nDetails: Compile error')
    expect(prompt).toContain('User hint:\nCheck DateService types')
    expect(prompt).toContain('Please fix the issues and try again.')
    expect(prompt).toContain('Original instruction:\nWrite feature')
  })

  it('ignores whitespace-only feedback string', () => {
    const promptWithMcp = formatGuardrailRetryPrompt(
      'Write feature',
      0,
      { status: 'fail', logKey: 'log-123' },
      undefined,
      '   ',
    )
    expect(promptWithMcp).not.toContain('User hint:')

    const promptWithoutMcp = formatGuardrailRetryPrompt(
      'Write feature',
      0,
      { status: 'fail', body: 'Syntax error' },
      undefined,
      '   ',
    )
    expect(promptWithoutMcp).not.toContain('User hint:')
  })
})
