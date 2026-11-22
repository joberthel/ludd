import type { KeyedRunUiEntry } from './run-tree-state.js'

export interface RenderedLogLine {
  key: string
  text: string
  color?: string
  bold?: boolean
  dimColor?: boolean
  italic?: boolean
}

export interface BuildRenderedLogLinesOptions {
  width: number
  showThoughts: boolean
  expandOutput: boolean
  maxOutputLines?: number
}

function wrapTextLine(text: string, prefix: string, maxWidth: number): string[] {
  const safeWidth = Math.max(10, maxWidth)
  const contentWidth = Math.max(4, safeWidth - prefix.length)
  if (text.length <= contentWidth) {
    return [`${prefix}${text}`]
  }
  const chunks: string[] = []
  let offset = 0
  while (offset < text.length) {
    chunks.push(`${prefix}${text.slice(offset, offset + contentWidth)}`)
    offset += contentWidth
  }
  return chunks
}

function pushWrappedBlock(
  out: RenderedLogLine[],
  entryId: number,
  blockPrefix: string,
  text: string,
  linePrefix: string,
  width: number,
  style: Omit<RenderedLogLine, 'key' | 'text'>,
): void {
  const rawLines = text.split(/\r?\n/)
  let lineIdx = 0
  for (const rawLine of rawLines) {
    const wrapped = wrapTextLine(rawLine, linePrefix, width)
    for (const segment of wrapped) {
      out.push({
        key: `${entryId}:${blockPrefix}:${lineIdx++}`,
        text: segment,
        ...style,
      })
    }
  }
}

export function buildRenderedLogLines(
  entries: readonly KeyedRunUiEntry[],
  options: BuildRenderedLogLinesOptions,
): RenderedLogLine[] {
  const width = Math.max(10, options.width)
  const maxOutputLines = options.maxOutputLines ?? 40
  const lines: RenderedLogLine[] = []

  for (const entry of entries) {
    switch (entry.kind) {
      case 'run.started':
        pushWrappedBlock(lines, entry.id, 'main', `◆ ${entry.harnessName}`, '', width, {
          bold: true,
          color: 'cyan',
        })
        break
      case 'run.resumed':
        pushWrappedBlock(lines, entry.id, 'main', `◆ ${entry.harnessName ?? 'Run'} (resumed)`, '', width, {
          bold: true,
          color: 'cyan',
        })
        break
      case 'run.passed':
        pushWrappedBlock(lines, entry.id, 'main', '✔ Run passed', '', width, {
          bold: true,
          color: 'green',
        })
        break
      case 'run.failed':
        pushWrappedBlock(
          lines,
          entry.id,
          'main',
          `✖ Run failed${entry.error !== undefined
            ? `: ${entry.error}`
            : ''}`,
          '',
          width,
          { bold: true, color: 'red' },
        )
        break
      case 'step.started':
        pushWrappedBlock(lines, entry.id, 'main', `▸ ${entry.stepId}`, '', width, {
          bold: true,
        })
        break
      case 'step.passed':
        pushWrappedBlock(lines, entry.id, 'main', `✔ ${entry.stepId} passed`, '', width, {
          color: 'green',
        })
        break
      case 'step.skipped':
        pushWrappedBlock(lines, entry.id, 'main', `↷ ${entry.stepId} skipped`, '', width, {
          dimColor: true,
        })
        break
      case 'step.failed':
        pushWrappedBlock(
          lines,
          entry.id,
          'main',
          `✖ ${entry.stepId} failed${entry.error !== undefined
            ? `: ${entry.error}`
            : ''}`,
          '',
          width,
          { color: 'red' },
        )
        break
      case 'step.retry':
        pushWrappedBlock(
          lines,
          entry.id,
          'main',
          `↻ retrying${entry.attempt !== undefined
            ? ` (attempt ${entry.attempt})`
            : ''}`,
          '  ',
          width,
          { color: 'yellow' },
        )
        break
      case 'guardrail.started':
        pushWrappedBlock(
          lines,
          entry.id,
          'main',
          `● guardrail${entry.name !== undefined
            ? ` ${entry.name}`
            : ''} running…`,
          '  ',
          width,
          { color: 'cyan' },
        )
        break
      case 'guardrail.passed':
      case 'guardrail.skipped':
      case 'guardrail.failed': {
        const icon = entry.kind === 'guardrail.passed'
          ? '✔'
          : entry.kind === 'guardrail.skipped'
            ? '↷'
            : '✖'
        const verb = entry.kind === 'guardrail.passed'
          ? 'passed'
          : entry.kind === 'guardrail.skipped'
            ? 'skipped'
            : 'failed'
        const style: Omit<RenderedLogLine, 'key' | 'text'> = entry.kind === 'guardrail.passed'
          ? { color: 'green' }
          : entry.kind === 'guardrail.skipped'
            ? { dimColor: true }
            : { color: 'red' }
        pushWrappedBlock(
          lines,
          entry.id,
          'main',
          `${icon} guardrail${entry.name !== undefined
            ? ` ${entry.name}`
            : ''} ${verb}`,
          '  ',
          width,
          style,
        )
        if (entry.output !== undefined && entry.output !== '') {
          const outputLines: RenderedLogLine[] = []
          pushWrappedBlock(outputLines, entry.id, 'out', entry.output, '    │ ', width, {
            dimColor: true,
          })
          if (!options.expandOutput && outputLines.length > maxOutputLines) {
            lines.push(...outputLines.slice(0, maxOutputLines))
            const remaining = outputLines.length - maxOutputLines
            lines.push({
              key: `${entry.id}:out:truncated`,
              text: `    … (${remaining} more ${remaining === 1
                ? 'line'
                : 'lines'} — press 'o' to expand)`,
              dimColor: true,
              italic: true,
            })
          }
          else {
            lines.push(...outputLines)
          }
        }
        if (entry.logKey !== undefined && entry.logKey !== '') {
          pushWrappedBlock(lines, entry.id, 'logKey', `logKey: ${entry.logKey}`, '    ', width, {
            dimColor: true,
          })
        }
        break
      }
      case 'tool.start':
        pushWrappedBlock(
          lines,
          entry.id,
          'main',
          `⚙ ${entry.toolName}${entry.argsSummary !== undefined
            ? `  ${entry.argsSummary}`
            : ''}`,
          '  ',
          width,
          { dimColor: true },
        )
        break
      case 'tool.error':
        pushWrappedBlock(lines, entry.id, 'main', `✖ ${entry.toolName} failed`, '  ', width, {
          color: 'red',
        })
        break
      case 'agent.thought': {
        if (!options.showThoughts) {
          break
        }
        lines.push({
          key: `${entry.id}:thought:hdr`,
          text: entry.streaming === true
            ? '  💭 thinking…'
            : '  💭 thought',
          dimColor: true,
          italic: true,
        })
        pushWrappedBlock(lines, entry.id, 'thought', entry.text, '  │ ', width, {
          dimColor: true,
          italic: true,
        })
        break
      }
      case 'agent.text':
        pushWrappedBlock(lines, entry.id, 'main', entry.text, '  ', width, {})
        break
      case 'agent.output':
        pushWrappedBlock(lines, entry.id, 'main', `↳ output  ${entry.output}`, '  ', width, {
          color: 'cyan',
        })
        break
      case 'prompt.answered':
        pushWrappedBlock(
          lines,
          entry.id,
          'main',
          `✔ ${entry.prompt} → ${entry.answer}`,
          '  ',
          width,
          {},
        )
        break
    }
  }

  return lines
}
