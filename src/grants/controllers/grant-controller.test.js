import { describe, beforeEach, it } from 'node:test'
import GrantController from './grant-controller.js'
import { DomainError } from '../errors/domain-error.js'
import GrantService from '../services/grant-service.js'
import { mock } from '../../common/tests.js'

describe('GrantController', () => {
  describe('getFromExternalEndpoint', () => {
    let grantService
    let grantController

    beforeEach(async () => {
      grantService = mock(GrantService)
      grantController = new GrantController({
        grantService
      })
    })

    it('returns 200 and the result from the service', async t => {
      t.plan(3)

      t.mock.method(grantService, 'getFromExternalEndpoint', async () => ({
        message: 'Success'
      }))

      const request = {
        logger: {
          error: t.mock.fn()
        },
        params: {
          id: '1',
          name: 'test'
        }
      }

      await grantController.getFromExternalEndpoint(request, {
        response: result => ({
          code: statusCode => {
            t.assert.deepStrictEqual(result, {
              message: 'Success'
            })
            t.assert.strictEqual(statusCode, 200)
          }
        })
      })

      t.assert.deepStrictEqual(
        grantService.getFromExternalEndpoint.mock.calls[0].arguments,
        ['1', 'test']
      )
    })

    it('returns 400 when DomainError is thrown', async t => {
      t.plan(2)

      t.mock.method(grantService, 'getFromExternalEndpoint', async () => {
        throw new DomainError('Grant has no GET endpoint named "test"')
      })

      const request = {
        logger: {
          error: t.mock.fn()
        },
        params: {
          id: '1',
          name: 'test'
        }
      }

      await grantController.getFromExternalEndpoint(request, {
        response: result => ({
          code: statusCode => {
            t.assert.deepStrictEqual(result, {
              message: 'Grant has no GET endpoint named "test"'
            })
            t.assert.strictEqual(statusCode, 400)
          }
        })
      })
    })

    it('returns 500 when an unexpected error is thrown', async t => {
      t.plan(2)

      t.mock.method(grantService, 'getFromExternalEndpoint', async () => {
        throw new Error('Unexpected error')
      })

      const request = {
        logger: {
          error: t.mock.fn()
        },
        params: {
          id: '1',
          name: 'test'
        }
      }

      await grantController.getFromExternalEndpoint(request, {
        response: result => ({
          code: statusCode => {
            t.assert.strictEqual(result, undefined)
            t.assert.strictEqual(statusCode, 500)
          }
        })
      })
    })
  })

  describe('postToExternalEndpoint', () => {
    let grantService
    let grantController

    beforeEach(async () => {
      grantService = mock(GrantService)
      grantController = new GrantController({
        grantService
      })
    })

    it('returns 200 and the result from the service', async t => {
      t.plan(3)

      t.mock.method(grantService, 'postToExternalEndpoint', async () => ({
        message: 'Success'
      }))

      const request = {
        logger: {
          error: t.mock.fn()
        },
        params: {
          id: '1',
          name: 'getPrices'
        },
        payload: {
          data: 'test'
        }
      }

      await grantController.postToExternalEndpoint(request, {
        response: result => ({
          code: statusCode => {
            t.assert.deepStrictEqual(result, {
              message: 'Success'
            })
            t.assert.strictEqual(statusCode, 200)
          }
        })
      })

      t.assert.deepStrictEqual(
        grantService.postToExternalEndpoint.mock.calls[0].arguments,
        ['1', 'getPrices', { data: 'test' }]
      )
    })

    it('returns 400 when DomainError is thrown', async t => {
      t.plan(2)

      t.mock.method(grantService, 'postToExternalEndpoint', async () => {
        throw new DomainError('Grant has no POST endpoint named "test"')
      })

      const request = {
        logger: {
          error: t.mock.fn()
        },
        params: {
          id: '1',
          name: 'test'
        },
        payload: {
          data: 'test'
        }
      }

      await grantController.postToExternalEndpoint(request, {
        response: result => ({
          code: statusCode => {
            t.assert.deepStrictEqual(result, {
              message: 'Grant has no POST endpoint named "test"'
            })
            t.assert.strictEqual(statusCode, 400)
          }
        })
      })
    })

    it('returns 500 when an unexpected error is thrown', async t => {
      t.plan(2)

      t.mock.method(grantService, 'postToExternalEndpoint', async () => {
        throw new Error('Unexpected error')
      })

      const request = {
        logger: {
          error: t.mock.fn()
        },
        params: {
          id: '1',
          name: 'test'
        },
        payload: {
          data: 'test'
        }
      }

      await grantController.postToExternalEndpoint(request, {
        response: result => ({
          code: statusCode => {
            t.assert.strictEqual(result, undefined)
            t.assert.strictEqual(statusCode, 500)
          }
        })
      })
    })
  })
})
