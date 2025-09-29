/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db, client) => {
  await db.createCollection('event_publication_outbox');

  // Create indexes for better performance
  await db.collection('event_publication_outbox').createIndex({ status: 1 });
  await db.collection('event_publication_outbox').createIndex({ publicationDate: 1 });
  await db.collection('event_publication_outbox').createIndex({ lastResubmissionDate: 1 });
  await db.collection('event_publication_outbox').createIndex({ listenerId: 1 });
  await db.collection('event_publication_outbox').createIndex({
    status: 1,
    completionAttempts: 1
  });
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db, client) => {
  await db.collection('event_publication_outbox').drop();
};
