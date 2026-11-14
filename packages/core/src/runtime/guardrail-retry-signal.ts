export class GuardrailRetrySignal extends Error {
  readonly prompt: string

  constructor(prompt: string) {
    super(prompt)
    this.name = 'GuardrailRetrySignal'
    this.prompt = prompt
  }
}
