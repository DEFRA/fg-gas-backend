import tls from 'node:tls'
import { config } from './config.js'

const getTrustStoreCerts = (envs) => Object
  .entries(envs)
  .map(([key, value]) => key.startsWith('TRUSTSTORE_') && value)
  .filter(envValue => Boolean(envValue))
  .map(envValue => Buffer.from(envValue, 'base64').toString().trim())

const originalTlsCreateSecureContext = tls.createSecureContext

export const secureContext = {
  init () {
    if (config.get('isSecureContextEnabled')) {
      tls.createSecureContext = (options = {}) => {
        const trustStoreCerts = getTrustStoreCerts(process.env)

        const tlsSecureContext = originalTlsCreateSecureContext(options)

        trustStoreCerts.forEach(cert => {
          tlsSecureContext.context.addCACert(cert)
        })

        return tlsSecureContext
      }
    }
  }
}
