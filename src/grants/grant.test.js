import { describe, it } from 'node:test'
import { assert } from '../common/assert.js'
import { Grant } from './grant.js'

describe('grant', () => {
  describe('create', () => {
    it('creates a grant with valid properties', () => {
      const grant = Grant.create({
        name: 'test grant',
        endpoints: [
          {
            name: 'endpoint1',
            method: 'GET',
            url: 'http://example.com'
          }
        ]
      })

      assert.ok(grant.grantId)
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

  describe('validateId', () => {
    it('parses a valid grantId', () => {
      assert.doesNotThrow(() => Grant.validateId('507f1f77bcf86cd799439011'))
    })

    it('throws an error for an invalid grantId', () => {
      assert.throws(() => Grant.validateId('invalid-id'), {
        message: '"grantId" must only contain hexadecimal characters'
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
