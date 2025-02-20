import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NotFoundError } from './not-found-error.js'

describe('NotFoundError', () => {
  it('is an instance of Error', () => {
    const error = new NotFoundError('name is required')
    assert.equal(error instanceof Error, true)
  })

  it('has a name of NotFoundError', () => {
    const error = new NotFoundError('name is required')
    assert.equal(error.name, 'NotFoundError')
  })

  it('has a message with reason', () => {
    const error = new NotFoundError('name is required')
    assert.equal(error.message, 'name is required')
  })

  it('has a stack trace', () => {
    const error = new NotFoundError('name is required')
    assert.equal(error.stack.includes('not-found-error.test.js'), true)
  })
})
