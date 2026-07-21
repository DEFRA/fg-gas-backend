import { Outbox } from "../grants/models/outbox.js";
import { insertMany } from "../grants/repositories/outbox.repository.js";

export const saveOutboxEvents = async (publications, session) => {
  const entries = publications.map(
    ({ event, target }) =>
      new Outbox({
        event,
        target,
        segregationRef: Outbox.getSegregationRef(event),
      }),
  );

  if (entries.length > 0) {
    await insertMany(entries, session);
  }
};
