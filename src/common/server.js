import hapi from '@hapi/hapi'
import hapiPino from 'hapi-pino'
import { AsyncLocalStorage } from 'node:async_hooks'

export default class Server {
  #server
  #logger
  #plugins

  static #asyncLocalStorage = new AsyncLocalStorage()

  static getTraceId () {
    return Server.#asyncLocalStorage.getStore()?.get('traceId')
  }

  constructor ({ config, logger }) {
    this.#logger = logger

    this.#server = hapi.server({
      port: config.get('port'),
      routes: {
        validate: {
          options: {
            abortEarly: false
          },
          failAction: (request, _h, error) => {
            request.logger.warn(error, error?.message)
            throw error
          }
        },
        security: {
          hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: false
          },
          xss: 'enabled',
          noSniff: true,
          xframe: true
        }
      },
      router: {
        stripTrailingSlash: true
      }
    })

    this.#server.ext('onRequest', (request, h) => {
      const traceId = request.headers['x-cdp-request-id'] || ''

      const store = new Map()
      store.set('traceId', traceId)

      Server.#asyncLocalStorage.enterWith(store)

      return h.continue
    })

    this.#server.ext('onPreResponse', this.#onPreResponse.bind(this))

    this.#plugins = [
      {
        plugin: hapiPino,
        options: {
          ignorePaths: ['/health'],
          instance: logger
        }
      }
    ]
  }

  #onPreResponse (request, h) {
    const response = request.response

    if (!response.isBoom) {
      return h.continue
    }

    this.#logger.error(response, `${response.name}: ${response.message}`)

    const message = {
      ValidationError: response.message,
      NotFoundError: response.message
    }[response.name] || 'Internal Server Error'

    const code = {
      ValidationError: 400,
      NotFoundError: 404
    }[response.name] || 500

    return h.response({
      error: {
        message
      }
    }).code(code)
  }

  addRoute (route) {
    this.#server.route(route)
  }

  async start () {
    await this.#server.register(this.#plugins)
    await this.#server.start()
  }

  async dispose () {
    await this.#server.stop()
  }
}
