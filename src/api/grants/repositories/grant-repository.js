import GrantEndpoint from '../entities/grant-endpoint.js'
import Grant from '../entities/grant.js'

export default class GrantRepository {
  #grants = [
    Grant.create({
      id: '1',
      name: 'Grant 1',
      endpoints: [
        GrantEndpoint.create({
          name: 'getPrices',
          method: 'GET',
          url: 'https://httpbin.org/anything'
        }),
        GrantEndpoint.create({
          name: 'calcTotals',
          method: 'POST',
          url: 'https://httpbin.org/post'
        })
      ]
    })
  ]

  /**
   * @param {string} id
   * @return {Promise<Grant | null>}
   */
  async getById (id) {
    return this.#grants.find(g => g.id === id) ?? null
  }
}
