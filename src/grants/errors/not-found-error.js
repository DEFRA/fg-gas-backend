export class NotFoundError extends Error {
  /**
   * @param {string} message
   */
  constructor (message) {
    super(message)
    this.name = 'NotFoundError'
  }
}
