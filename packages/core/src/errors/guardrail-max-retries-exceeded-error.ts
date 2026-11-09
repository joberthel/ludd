import type { GuardrailVerdict } from '../types/guardrail.js'

export class GuardrailMaxRetriesExceededError extends Error {
  readonly stepId: string
  readonly guardrailIndex: number
  readonly maxRetries: number
  readonly verdict: GuardrailVerdict<unknown>

  constructor(
    stepId: string,
    guardrailIndex: number,
    maxRetries: number,
    verdict: GuardrailVerdict<unknown>,
  ) {
    const verdictDetails = verdict.body !== undefined
      ? `: ${typeof verdict.body === 'string'
        ? verdict.body
        : JSON.stringify(verdict.body)}`
      : ''
    super(
      `Step "${stepId}" guardrail #${guardrailIndex} exceeded maximum retries (${maxRetries})${verdictDetails}.`,
    )
    this.name = 'GuardrailMaxRetriesExceededError'
    this.stepId = stepId
    this.guardrailIndex = guardrailIndex
    this.maxRetries = maxRetries
    this.verdict = verdict
  }
}
