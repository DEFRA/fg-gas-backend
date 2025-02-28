import tls from 'tls'

import { config } from './common/config.js'
import { App } from './common/app.js'

function getTrustStoreCerts (envs) {
  return Object.entries(envs)
    .map(([key, value]) => key.startsWith('TRUSTSTORE_') && value)
    .filter(
      /** @returns {envValue is string} */
      envValue => Boolean(envValue)
    )
    .map(envValue => Buffer.from(envValue, 'base64').toString().trim())
}

if (config.get('isSecureContextEnabled')) {
  const originalTlsCreateSecureContext = tls.createSecureContext

  tls.createSecureContext = function (options = {}) {
    const trustStoreCerts = getTrustStoreCerts(process.env)

    const tlsSecureContext = originalTlsCreateSecureContext(options)

    trustStoreCerts.forEach(cert => {
      tlsSecureContext.context.addCACert(cert)
    })

    return tlsSecureContext
  }
}

new App().run()
