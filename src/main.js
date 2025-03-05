import { logger } from './common/logger.js'
import { secureContext } from './common/secure-context.js'
import { createServer } from './server.js'

process.on('unhandledRejection', error => {
  logger.error(error, 'Unhandled rejection')
  process.exitCode = 1
})

secureContext.init()

const server = await createServer()
await server.start()
