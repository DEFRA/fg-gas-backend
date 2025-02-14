import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import ValidationError from '../errors/validation-error.js'
import GrantEndpoint from './grant-endpoint.js'

describe('GrantEndpoint', () => {
  it('can be created with valid fields', () => {
    const endpoint = GrantEndpoint.create({
      name: 'endpoint1',
      method: 'GET',
      url: 'https://example.com'
    })

    assert.equal(endpoint instanceof GrantEndpoint, true)
    assert.equal(endpoint.name, 'endpoint1')
    assert.equal(endpoint.method, 'GET')
    assert.equal(endpoint.url, 'https://example.com')
  })

  it('cannot be created without name', () => {
    assert.throws(() => {
      GrantEndpoint.create({
        method: 'GET',
        url: 'https://example.com'
      })
    }, new ValidationError('GrantEndpoint name is required'))
  })

  it('cannot be created without a method', () => {
    assert.throws(() => {
      GrantEndpoint.create({
        name: 'grant1',
        url: 'https://example.com'
      })
    }, new ValidationError('GrantEndpoint method is invalid. Got undefined'))
  })

  it('cannot be created without a url', () => {
    assert.throws(() => {
      GrantEndpoint.create({
        name: 'grant1',
        method: 'GET'
      })
    }, new ValidationError('GrantEndpoint url is required'))
  })
})
