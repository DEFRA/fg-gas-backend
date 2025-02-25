export class ValidationError extends Error {
  /**
   * @param {string} reason
   */
  constructor (reason) {
    super(reason)
    this.name = 'ValidationError'
  }
}
