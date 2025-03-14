import { describe, it } from 'node:test'
import { assert } from '../common/assert.js'
import { Grant } from './grant.js'

describe('grant', () => {
  describe('create', () => {
    it('creates a grant with valid properties', () => {
      const grant = Grant.create({
        name: 'test grant',
        code: 'test-code',
        endpoints: [
          {
            name: 'endpoint1',
            method: 'GET',
            url: 'http://example.com'
          }
        ]
      })

      assert.equal(grant.code, 'test-code')
      assert.equal(grant.name, 'test grant')
      assert.deepEqual(grant.endpoints, [{
        name: 'endpoint1',
        method: 'GET',
        url: 'http://example.com'
      }])
    })

    it('throws when properties invalid', () => {
      const props = {
        name: '',
        code: '',
        endpoints: [{
          name: 'endpoint1',
          method: 'INVALID',
          url: 'invalid-url'
        }]
      }

      assert.throws(() => Grant.create(props), {
        message: '"name" is not allowed to be empty'
      })
    })
  })

  describe('validateCode', () => {
    it('parses a valid code', () => {
      assert.doesNotThrow(() => Grant.validateCode('test-code'))
    })

    it('throws an error for an invalid code', () => {
      assert.throws(() => Grant.validateCode(''), {
        message: '"code" is not allowed to be empty'
      })
    })
  })

  describe('validateEndpointName', () => {
    it('parses a valid endpoint name', () => {
      assert.doesNotThrow(() => {
        Grant.validateEndpointName('test-endpoint')
      })
    })

    it('throws an error for an invalid endpoint name', () => {
      assert.throws(() => Grant.validateEndpointName(''), {
        message: '"name" is not allowed to be empty'
      })
    })
  })

  describe('validateEndpointPayload', () => {
    it('parses a valid payload', () => {
      assert.doesNotThrow(() => Grant.validateEndpointPayload({ key: 'value' }))
    })

    it('throws an error for an invalid payload', () => {
      assert.throws(() => Grant.validateEndpointPayload(null), {
        message: '"value" must be of type object'
      })
    })
  })
})
