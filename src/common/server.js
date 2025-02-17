import hapi from '@hapi/hapi'
import hapiPino from 'hapi-pino'
import { tracing } from '@defra/hapi-tracing'

export default class Server {
  #server
  #plugins

  constructor ({ config, logger }) {
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

    this.#plugins = [
      {
        plugin: hapiPino,
        options: {
          ignorePaths: ['/health'],
          instance: logger
        }
      },
      {
        plugin: tracing.plugin,
        options: {
          tracingHeader: config.get('tracing.header')
        }
      }
    ]
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
