import Joi from "joi";
// eslint-disable-next-line import-x/no-restricted-paths
import { db } from "../../common/mongo-client.js";

// temporary route to add documents to db
export const addOutboxRoute = {
  method: "POST",
  path: "/outbox",
  options: {
    description: "foo",
    tags: ["api"],
    validate: {
      payload: Joi.object(),
    },
  },
  async handler(request, h) {
    const outbox = request.payload;
    await db.collection("event_publication_outbox").insertOne({
      ...outbox,
      publicationDate: new Date().toISOString(),
    });
    return h.response().code(200);
  },
};
