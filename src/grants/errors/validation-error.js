export default class ValidationError extends Error {
  /**
   * @param {string[]} reasons
   */
  constructor (reason) {
    super(reason)
    this.name = 'ValidationError'
  }
}
