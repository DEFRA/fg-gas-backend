import { describe, it } from 'node:test'
import HealthController from './health-controller.js'

describe('HealthController', () => {
  describe('getHealth', () => {
    it('returns 200', async (t) => {
      t.plan(2)

      const healthController = new HealthController()

      await healthController.getHealth({}, {
        response: (result) => ({
          code: (statusCode) => {
            t.assert.deepStrictEqual(result, { message: 'success' })
            t.assert.deepEqual(statusCode, 200)
          }
        })
      }
      )
    })
  })
})
