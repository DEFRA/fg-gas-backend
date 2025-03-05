import { strict } from 'assert'

/**
 * @import {Mock} from 'node:test'
 * @typedef {Mock<unknown>} MockedFunction
 */

const validateMock = fn => {
  strict.ok(fn?.mock, new Error('Expected a mocked function'))
}

export const assert = {
  ...strict,

  /**
   * @param {MockedFunction} fn
   */
  calledOnce (fn) {
    validateMock(fn)

    strict.ok(
      fn.mock.calls.length === 1,
      new Error(
        `Expected ${fn.name} to have been called once. Called ${fn.mock.calls.length}`
      )
    )
  },

  /**
   * @param {MockedFunction} fn
   * @param {...any} args
   */
  calledOnceWith (fn, ...args) {
    assert.calledOnce(fn)

    strict.deepEqual(fn.mock.calls[0].arguments, args)
  },

  /**
   * @param {MockedFunction} fn
   */
  notCalled (fn) {
    validateMock(fn)

    strict.equal(
      fn.mock.calls.length,
      0,
      new Error(`Expected ${fn.name} not to have been called`)
    )
  }
}
