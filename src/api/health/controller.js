import { statusCodes } from '../common/constants/status-codes.js'

const healthController = {
  handler: (_request, h) =>
    h.response({ message: 'success' }).code(statusCodes.ok)
}

export { healthController }
