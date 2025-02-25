import { pino } from 'pino'
import { ecsFormat } from '@elastic/ecs-pino-format'
import { config } from './config.js'
import Server from './server.js'

const logConfig = config.get('log')

const format = {
  ecs: {
    ...ecsFormat({
      serviceVersion: config.get('serviceVersion'),
      serviceName: config.get('serviceName')
    })
  },
  'pino-pretty': {
    transport: {
      target: 'pino-pretty'
    }
  }
}[logConfig.format]

export const logger = pino({
  enabled: logConfig.enabled,
  ignorePaths: ['/health'],
  redact: {
    paths: logConfig.redact,
    remove: true
  },
  level: logConfig.level,
  ...format,
  nesting: true,
  mixin () {
    const mixinValues = {}
    const traceId = Server.getTraceId()
    if (traceId) {
      mixinValues.trace = {
        id: traceId
      }
    }
    return mixinValues
  }
})
