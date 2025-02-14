import process from 'node:process'
import { logger } from './logger.js'
import { createContainer } from './container.js'

export class App {
  #container

  async #start () {
    logger.info('Starting...')
    try {
      this.#container = await createContainer()

      const server = this.#container.resolve('server')

      server.addRoute(this.#container.resolve('healthController').routes)
      server.addRoute(this.#container.resolve('grantController').routes)

      await server.start()
    } catch (error) {
      logger.error(error, 'Failed to start')
      process.exit(1)
    }
  }

  async #stop () {
    logger.info('Stopping...')
    try {
      await this.#container.dispose()
      process.exit(0)
    } catch (error) {
      logger.error(error, 'Failed to stop gracefully')
      process.exit(1)
    }
  }

  #onUnhandledError (error) {
    logger.error(error)
    process.exitCode = 1
  }

  async run () {
    process.on('unhandledRejection', error => this.#onUnhandledError(error))
    process.on('uncaughtException', error => this.#onUnhandledError(error))

    await this.#start()

    process.on('SIGINT', () => this.#stop())
    process.on('SIGTERM', () => this.#stop())
  }
}
