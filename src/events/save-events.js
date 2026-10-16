import { Outbox } from "./models/outbox.js";
import { insertMany } from "./repositories/outbox.repository.js";
import { outboxStamps } from "./stamps.js";

const toOutbox = ({ event, target, segregationRef }) => {
  const orderingKey = segregationRef ?? Outbox.getSegregationRef(event);

  return new Outbox({
    event,
    target,
    segregationRef: orderingKey,
    ...outboxStamps(event, { segregationRef: orderingKey }),
  });
};

// Publications may supply an explicit segregation reference when the generic
// event-data rules cannot derive one.
export const saveEvents = async (publications, session) => {
  const entries = publications.map(toOutbox);

  if (entries.length > 0) {
    await insertMany(entries, session);
  }
};
