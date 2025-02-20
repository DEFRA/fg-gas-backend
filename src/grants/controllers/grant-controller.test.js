import { describe, beforeEach, it } from 'node:test'
import GrantController from './grant-controller.js'
import GrantService from '../services/grant-service.js'
import { mock } from '../../common/tests.js'
import { ValidationError } from '../errors/validation-error.js'
import { NotFoundError } from '../errors/not-found-error.js'

describe('GrantController', () => {
  describe('create', () => {
    let grantService
    let grantController

    beforeEach(async () => {
      grantService = mock(GrantService)
      grantController = new GrantController({
        grantService
      })
    })

    it('returns 200 and the created grant id', async t => {
      t.plan(3)

      t.mock.method(grantService, 'create', async () => ({
        id: '1'
      }))

      const request = {
        logger: {
          error: t.mock.fn()
        },
        payload: {
          name: 'test'
        }
      }

      await grantController.create(request, {
        response: result => ({
          code: statusCode => {
            t.assert.deepStrictEqual(result, {
              id: '1'
            })
            t.assert.strictEqual(statusCode, 201)
          }
        })
      })

      t.assert.deepStrictEqual(
        grantService.create.mock.calls[0].arguments,
        [{ name: 'test' }]
      )
    })

    it('returns 400 when ValidationError is thrown', async t => {
      t.plan(2)

      t.mock.method(grantService, 'create', async () => {
        throw new ValidationError('Grant "name" is required')
      })

      const request = {
        logger: {
          error: t.mock.fn()
        }
      }

      await grantController.create(request, {
        response: result => ({
          code: statusCode => {
            t.assert.deepStrictEqual(result, {
              message: 'Grant "name" is required'
            })
            t.assert.strictEqual(statusCode, 400)
          }
        })
      })
    })

    it('returns 500 when an unexpected error is thrown', async t => {
      t.plan(2)

      t.mock.method(grantService, 'create', async () => {
        throw new Error('Unexpected error')
      })

      const request = {
        logger: {
          error: t.mock.fn()
        }
      }

      await grantController.create(request, {
        response: result => ({
          code: statusCode => {
            t.assert.strictEqual(result, undefined)
            t.assert.strictEqual(statusCode, 500)
          }
        })
      })
    })
  })

  describe('getAll', () => {
    let grantService
    let grantController

    beforeEach(async () => {
      grantService = mock(GrantService)
      grantController = new GrantController({
        grantService
      })
    })

    it('returns 200 and all grants', async t => {
      t.plan(3)

      t.mock.method(grantService, 'getAll', async () => [
        {
          id: '1',
          name: 'test',
          endpoints: []
        },
        {
          id: '2',
          name: 'test2',
          endpoints: []
        }
      ])

      const request = {}

      await grantController.getAll(request, {
        response: result => ({
          code: statusCode => {
            t.assert.deepStrictEqual(result, [
              {
                id: '1',
                name: 'test',
                endpoints: []
              },
              {
                id: '2',
                name: 'test2',
                endpoints: []
              }
            ])
            t.assert.strictEqual(statusCode, 200)
          }
        })
      })

      t.assert.deepStrictEqual(
        grantService.getAll.mock.calls[0].arguments,
        []
      )
    })
  })

  describe('getById', () => {
    let grantService
    let grantController

    beforeEach(async () => {
      grantService = mock(GrantService)
      grantController = new GrantController({
        grantService
      })
    })

    it('returns 200 and the grant', async t => {
      t.plan(3)

      t.mock.method(grantService, 'getById', async () => ({
        id: '1',
        name: 'test',
        endpoints: []
      }))

      const request = {
        params: {
          id: '1'
        }
      }

      await grantController.getById(request, {
        response: result => ({
          code: statusCode => {
            t.assert.deepStrictEqual(result, {
              id: '1',
              name: 'test',
              endpoints: []
            })
            t.assert.strictEqual(statusCode, 200)
          }
        })
      })

      t.assert.deepStrictEqual(
        grantService.getById.mock.calls[0].arguments,
        ['1']
      )
    })

    it('returns 404 when no grant is found', async t => {
      t.plan(2)

      t.mock.method(grantService, 'getById', async () => null)

      const request = {
        params: {
          id: '1'
        }
      }

      await grantController.getById(request, {
        response: result => ({
          code: statusCode => {
            t.assert.strictEqual(result, undefined)
            t.assert.strictEqual(statusCode, 404)
          }
        })
      })
    })
  })

  describe('invokeEndpoint', () => {
    let grantService
    let grantController

    beforeEach(async () => {
      grantService = mock(GrantService)
      grantController = new GrantController({
        grantService
      })
    })

    it('returns 200 and the result from invoking a GET endpoint', async t => {
      t.plan(3)

      t.mock.method(grantService, 'invokeEndpoint', async () => ({
        message: 'Success'
      }))

      const request = {
        method: 'get',
        logger: {
          error: t.mock.fn()
        },
        params: {
          id: '1',
          name: 'test'
        }
      }

      await grantController.invokeEndpoint(request, {
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
        grantService.invokeEndpoint.mock.calls[0].arguments,
        ['1', 'test', 'get', undefined]
      )
    })

    it('returns 200 and the result from invoking a POST endpoint', async t => {
      t.plan(3)

      t.mock.method(grantService, 'invokeEndpoint', async () => ({
        message: 'Success'
      }))

      const request = {
        method: 'post',
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

      await grantController.invokeEndpoint(request, {
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
        grantService.invokeEndpoint.mock.calls[0].arguments,
        ['1', 'test', 'post', { data: 'test' }]
      )
    })

    it('returns 400 when ValidationError is thrown', async t => {
      t.plan(2)

      t.mock.method(grantService, 'invokeEndpoint', async () => {
        throw new ValidationError('Grant has no GET endpoint named "test"')
      })

      const request = {
        method: 'get',
        logger: {
          error: t.mock.fn()
        },
        params: {
          id: '1',
          name: 'test'
        }
      }

      await grantController.invokeEndpoint(request, {
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

    it('returns 404 when NotFoundError is thrown', async t => {
      t.plan(2)

      t.mock.method(grantService, 'invokeEndpoint', async () => {
        throw new NotFoundError('Grant has no GET endpoint named "test"')
      })

      const request = {
        method: 'get',
        logger: {
          error: t.mock.fn()
        },
        params: {
          id: '1',
          name: 'test'
        }
      }

      await grantController.invokeEndpoint(request, {
        response: result => ({
          code: statusCode => {
            t.assert.deepStrictEqual(result, {
              message: 'Grant has no GET endpoint named "test"'
            })
            t.assert.strictEqual(statusCode, 404)
          }
        })
      })
    })

    it('returns 500 when an unexpected error is thrown', async t => {
      t.plan(2)

      t.mock.method(grantService, 'invokeEndpoint', async () => {
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

      await grantController.invokeEndpoint(request, {
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
