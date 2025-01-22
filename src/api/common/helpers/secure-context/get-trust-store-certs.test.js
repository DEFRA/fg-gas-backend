import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'
import { getTrustStoreCerts } from './get-trust-store-certs.js'

describe('#getTrustStoreCerts', () => {
  const mockProcessEnvWithCerts = {
    TRUSTSTORE_CA_ONE:
      'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCm1vY2stY2VydC1kb3JpcwotLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0tCg==',
    UNRELATED_ENV: 'not-a-cert'
  }

  it('Should provide expected result with "certs"', () => {
    assert.deepEqual(getTrustStoreCerts(mockProcessEnvWithCerts), [
      '-----BEGIN CERTIFICATE-----\nmock-cert-doris\n-----END CERTIFICATE-----'
    ])
  })

  it('Should provide expected empty array', () => {
    assert.deepEqual(getTrustStoreCerts({}), [])
  })
})
