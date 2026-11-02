import chalk from 'chalk'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { EMPTY_PLACEHOLDER, OptionalText } from './optional-text.js'

describe('optionalText component', () => {
  it('renders value when present', () => {
    const { lastFrame } = render(<OptionalText value="My Description" />)
    expect(lastFrame()).toContain('My Description')
    expect(lastFrame()).not.toContain(EMPTY_PLACEHOLDER)
  })

  it('renders dimmed (none) placeholder when value is empty or undefined', () => {
    const { lastFrame: frameEmpty } = render(<OptionalText value="" />)
    expect(frameEmpty()).toContain(chalk.dim(EMPTY_PLACEHOLDER))

    const { lastFrame: frameUndefined } = render(<OptionalText />)
    expect(frameUndefined()).toContain(chalk.dim(EMPTY_PLACEHOLDER))
  })
})
