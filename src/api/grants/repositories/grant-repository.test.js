import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import GrantRepository from './grant-repository.js'
import Grant from '../entities/grant.js'

describe('GrantRepository', () => {
  describe('getById', () => {
    it('returns matching grant', async () => {
      const grantRepository = new GrantRepository()

      const result = await grantRepository.getById('1')

      assert.equal(result instanceof Grant, true)
      assert.equal(result.id, '1')
    })

    it('returns null when grant is not found', async () => {
      const grantRepository = new GrantRepository()

      const result = await grantRepository.getById('2')

      assert.equal(result, null)
    })
  })
})
