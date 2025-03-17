import hapi from '@hapi/hapi'
import hapiPino from 'hapi-pino'
import hapiPulse from 'hapi-pulse'
import { tracing } from '@defra/hapi-tracing'
import { logger } from './common/logger.js'
import { config } from './common/config.js'
import { healthPlugin } from './health/index.js'
import { grantsPlugin } from './grants/index.js'
import { mongoPlugin } from './plugins/mongodb.js'
import { createGrantRepository } from './grants/grant-repository.js'
import { createGrantService } from './grants/grant-service.js'

export const createServer = async () => {
  const server = hapi.server({
    port: config.get('port'),
    routes: {
      validate: {
        options: {
          abortEarly: false
        },
        failAction: async (_request, _h, error) => {
          logger.warn(error, error?.message)
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

  await server.register([
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
    },
    {
      plugin: hapiPulse,
      options: {
        logger,
        timeout: 10_000
      }
    },
    {
      plugin: mongoPlugin,
      options: {
        uri: config.get('mongoUri'),
        dbName: config.get('mongoDatabase')
      }
    },
    {
      plugin: healthPlugin
    }
  ])

  server.app.grantRepository = createGrantRepository(server.app.db)
  server.app.grantService = createGrantService(server.app.grantRepository)

  await server.register([
    {
      plugin: grantsPlugin,
      options: {
        grantService: server.app.grantService
      }
    }
  ])
  return server
}
