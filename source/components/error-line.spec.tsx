import chalk from 'chalk'
import { render } from 'ink-testing-library'
import React from 'react'
import { describe, expect, it } from 'vitest'
import { ErrorLine, toMessage } from './error-line.js'

describe('error-line component and toMessage helper', () => {
  it('toMessage extracts message from Error object', () => {
    expect(toMessage(new Error('Sample error'))).toBe('Sample error')
  })

  it('toMessage converts non-Error to string', () => {
    expect(toMessage('Plain string error')).toBe('Plain string error')
    expect(toMessage(404)).toBe('404')
  })

  it('renders [ERROR] badge with the given message', () => {
    const { lastFrame } = render(<ErrorLine message="Directory not found" />)
    expect(lastFrame()).toContain(chalk.red('[ERROR]'))
    expect(lastFrame()).toContain('Directory not found')
  })
})
