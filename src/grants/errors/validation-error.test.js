import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ValidationError } from './validation-error.js'

describe('ValidationError', () => {
  it('is an instance of Error', () => {
    const error = new ValidationError('name is required')
    assert.equal(error instanceof Error, true)
  })

  it('has a name of ValidationError', () => {
    const error = new ValidationError('name is required')
    assert.equal(error.name, 'ValidationError')
  })

  it('has a message with reason', () => {
    const error = new ValidationError('name is required')
    assert.equal(error.message, 'name is required')
  })

  it('has a stack trace', () => {
    const error = new ValidationError('name is required')
    assert.equal(error.stack.includes('validation-error.test.js'), true)
  })
})
