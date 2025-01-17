import Boom from '@hapi/boom'
import isNull from 'lodash/isNull.js'

import { findExampleData } from '../helpers/find-example-data.js'
import { statusCodes } from '../../common/constants/status-codes.js'

const exampleFindOneController = {
  handler: async (request, h) => {
    const entity = await findExampleData(request.db, request.params.exampleId)
    if (isNull(entity)) {
      return Boom.boomify(Boom.notFound())
    }

    return h.response({ message: 'success', entity }).code(statusCodes.ok)
  }
}

export { exampleFindOneController }
