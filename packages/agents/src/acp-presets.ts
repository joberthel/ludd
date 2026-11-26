import type { AgentRunner, StepContext } from '@luddjs/core'
import type { AcpAgentConfig } from './acp-agent.js'
import { acpAgent } from './acp-agent.js'

const DEFAULT_ACP_ARGS = ['--acp'] as const

/** Options accepted by the thin ACP preset factories (`claudeAcp`, `codexAcp`, `agyAcp`). */
export interface AcpPresetOptions<
  TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>,
> extends Omit<AcpAgentConfig<TContext>, 'command'> {
  /** Override the default preset executable binary or command. */
  command?: string
}

function buildPresetConfig<TContext extends StepContext<any, any, any, any>>(
  defaultCommand: string,
  options: AcpPresetOptions<TContext>,
): AcpAgentConfig<TContext> {
  return {
    ...options,
    command: options.command ?? defaultCommand,
    args: options.args ?? [...DEFAULT_ACP_ARGS],
  }
}

/**
 * Creates a thin ACP `AgentRunner` preset for Claude CLI (`claude --acp`).
 */
export function claudeAcp<
  TOutput = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>,
>(options: AcpPresetOptions<TContext> = {}): AgentRunner<TOutput, TContext> {
  return acpAgent<TOutput, TContext>(buildPresetConfig('claude', options))
}

/**
 * Creates a thin ACP `AgentRunner` preset for Codex CLI (`codex --acp`).
 */
export function codexAcp<
  TOutput = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>,
>(options: AcpPresetOptions<TContext> = {}): AgentRunner<TOutput, TContext> {
  return acpAgent<TOutput, TContext>(buildPresetConfig('codex', options))
}

/**
 * Creates a thin ACP `AgentRunner` preset for Agy CLI (`agy --acp`).
 */
export function agyAcp<
  TOutput = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>,
>(options: AcpPresetOptions<TContext> = {}): AgentRunner<TOutput, TContext> {
  return acpAgent<TOutput, TContext>(buildPresetConfig('agy', options))
}
