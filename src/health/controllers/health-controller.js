export default class HealthController {
  routes = [
    {
      method: 'GET',
      path: '/health',
      handler: this.getHealth.bind(this)
    }
  ]

  getHealth (_, h) {
    return h.response({ message: 'success' }).code(200)
  }
}
