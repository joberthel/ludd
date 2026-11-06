import { describe, expect, it } from 'vitest'
import * as core from './index.js'

describe('@ludd/core exports contract', () => {
  it('foo is bar', () => {
    expect(core.foo).toEqual('bar')
  })

  it('bar is a function that returns foo', () => {
    expect(core.bar()).toEqual('foo')
  })
})
