import path from 'node:path'
import {
  asClass,
  asValue,
  Lifetime,
  createContainer as createAwilixContainer
} from 'awilix'
import { config } from './config.js'
import { logger } from './logger.js'

export const createContainer = async () => {
  const container = createAwilixContainer()

  const root = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..'
  )

  await container.loadModules([`${root}/**/!(*.test.js)`], {
    resolverOptions: {
      register: asClass,
      lifetime: Lifetime.SINGLETON
    },
    formatName: 'camelCase',
    esModules: true
  })

  container.register({
    config: asValue(config),
    logger: asValue(logger)
  })

  return container
}
