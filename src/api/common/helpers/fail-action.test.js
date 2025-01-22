import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { failAction } from './fail-action.js'

describe('#fail-action', () => {
  it('Should throw expected error', () => {
    const mockRequest = {}
    const mockToolkit = {}
    const mockError = Error('Something terrible has happened!')

    assert.throws(() => failAction(mockRequest, mockToolkit, mockError), {
      name: 'Error',
      message: 'Something terrible has happened!'
    })
  })
})
