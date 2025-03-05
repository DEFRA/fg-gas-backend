import { logger } from './common/logger.js'
import { createServer } from './server.js'

process.on('unhandledRejection', error => {
  logger.error(error, 'Unhandled rejection')
  process.exitCode = 1
})

const server = await createServer()
await server.start()
