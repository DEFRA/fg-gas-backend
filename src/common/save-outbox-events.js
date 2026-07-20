import { Outbox } from "./outbox.js";
import { insertMany } from "./outbox.repository.js";

export const saveOutboxEvents = async (outboxEvents, session) => {
  const outboxEntries = (outboxEvents ?? []).map(
    ({ event, target }) =>
      new Outbox({
        event,
        target,
        segregationRef: Outbox.getSegregationRef(event),
      }),
  );

  if (outboxEntries.length > 0) {
    await insertMany(outboxEntries, session);
  }
};
