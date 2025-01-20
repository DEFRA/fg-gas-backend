function findAllExampleData (db) {
  const cursor = db
    .collection('example-data')
    .find({}, { projection: { _id: 0 } })

  return cursor.toArray()
}

export { findAllExampleData }
