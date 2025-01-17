import { findAllExampleData } from '../helpers/find-all-example-data.js'
import { statusCodes } from '../../common/constants/status-codes.js'

const exampleFindAllController = {
  handler: async (request, h) => {
    const entities = await findAllExampleData(request.db)

    return h.response({ message: 'success', entities }).code(statusCodes.ok)
  }
}

export { exampleFindAllController }
