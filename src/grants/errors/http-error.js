export class HttpError extends Error {
  /**
   * @param {string} message
   * @param {Object} args
   * @param {Request} args.request
   * @param {Response} args.response
   * @param {Error} args.cause
   */
  constructor (message, { cause, request, response }) {
    super(message)
    this.name = 'HttpError'
    this.cause = cause

    this.request = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers)
    }

    this.response = response
      ? {
          status: response.status,
          statusText: response.statusText
        }
      : null
  }
}
