import { Outbox } from "./models/outbox.js";
import { insertMany } from "./repositories/outbox.repository.js";

// Publications may supply an explicit segregation reference when the generic
// event-data rules cannot derive one.
export const saveEvents = async (publications, session) => {
  const entries = publications.map(
    ({ event, target, segregationRef }) =>
      new Outbox({
        event,
        target,
        segregationRef: segregationRef ?? Outbox.getSegregationRef(event),
      }),
  );

  if (entries.length > 0) {
    await insertMany(entries, session);
  }
};
