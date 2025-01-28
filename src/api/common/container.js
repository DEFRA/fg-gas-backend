import path from 'node:path'
import { asClass, createContainer as createAwilixContainer } from 'awilix'

export const createContainer = async () => {
  const container = createAwilixContainer()

  const root = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..'
  )

  await container.loadModules(
    [`${root}/**/!(*.test.js)`],
    {
      resolverOptions: {
        register: asClass
      },
      formatName: 'camelCase',
      esModules: true
    }
  )

  return container
}
