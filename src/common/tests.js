const isAsync = (fn) => fn.constructor.name === 'AsyncFunction'

export const mock = (klass) => {
  const instance = Object.create(klass.prototype)
  const props = Object.getOwnPropertyDescriptors(instance)

  for (const [key, value] of Object.entries(props)) {
    if (typeof value.value === 'function') {
      instance[key] = isAsync(value.value) ? async function () {} : function () {}
    }
  }

  return instance
}
