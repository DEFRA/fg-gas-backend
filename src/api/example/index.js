import {
  exampleFindOneController,
  exampleFindAllController
} from './controllers/index.js'

const example = {
  plugin: {
    name: 'example',
    register: (server) => {
      server.route([
        {
          method: 'GET',
          path: '/example',
          ...exampleFindAllController
        },
        {
          method: 'GET',
          path: '/example/{exampleId}',
          ...exampleFindOneController
        }
      ])
    }
  }
}

export { example }
