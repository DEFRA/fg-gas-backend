import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Grant } from './grant.js'
import { ValidationError } from '../errors/validation-error.js'
import { GrantEndpoint } from './grant-endpoint.js'

describe('Grant', () => {
  it('can be created with valid fields', () => {
    const endpoint = GrantEndpoint.create({
      name: 'endpoint1',
      method: 'GET',
      url: 'https://example.com'
    })

    const grant = Grant.create({
      id: 'MTExMTExMTExMTExMTExMTEx',
      name: 'grant1',
      endpoints: [endpoint]
    })

    assert.equal(grant instanceof Grant, true)
    assert.equal(grant.id, 'MTExMTExMTExMTExMTExMTEx')
    assert.equal(grant.name, 'grant1')
    assert.deepEqual(grant.endpoints, [endpoint])
  })

  it('cannot be created without name', () => {
    assert.throws(() => {
      Grant.create({
        id: 'MTExMTExMTExMTExMTExMTEx',
        endpoints: []
      })
    }, new ValidationError('Grant "name" is required'))
  })

  it('can only contain GrantEndpoints as endpoints', () => {
    assert.throws(() => {
      Grant.create({
        id: 'MTExMTExMTExMTExMTExMTEx',
        name: 'grant1',
        endpoints: [
          {
            not: 'a GrantEndpoint'
          }
        ]
      })
    }, new ValidationError('Grant "endpoints[0].name" is required'))
  })
})
