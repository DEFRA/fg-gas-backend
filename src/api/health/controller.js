const healthController = {
  handler: (_request, h) => h.response({ message: 'success' }).code(200)
}

export { healthController }
