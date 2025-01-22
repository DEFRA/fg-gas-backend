import { describe, it, before, after } from 'node:test'
import { strict as assert } from 'node:assert'
import { createServer } from '../index.js'

describe('#healthController', () => {
  let server

  before(async () => {
    server = await createServer()
    await server.initialize()
  })

  after(async () => {
    await server.stop({ timeout: 0 })
  })

  it('Should provide expected response', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/health'
    })

    assert.deepEqual(result, { message: 'success' })
    assert.equal(statusCode, 200)
  })
})
