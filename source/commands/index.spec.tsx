import chalk from 'chalk'
import { render } from 'ink-testing-library'
import React from 'react'
import { describe, expect, it } from 'vitest'
import Index from './index.js'

describe('index component', () => {
  it('greet user', () => {
    const { lastFrame } = render(<Index options={{ name: 'Jane' }} />)

    expect(lastFrame()).toBe(`Hello, ${chalk.green('Jane')}`)
  })
})
