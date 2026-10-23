import { Outbox } from "./models/outbox.js";
import { insertMany } from "./repositories/outbox.repository.js";
import { outboxStamps } from "./stamps.js";

const toOutbox = ({ event, target, segregationRef, refs }) => {
  const orderingKey = segregationRef ?? Outbox.getSegregationRef(event);

  return new Outbox({
    event,
    target,
    segregationRef: orderingKey,
    ...outboxStamps(event, { segregationRef: orderingKey, refs }),
  });
};

// Publications may supply an explicit segregation reference when the generic
// event-data rules cannot derive one, and refs the envelope does not carry.
export const saveEvents = async (publications, session) => {
  const entries = publications.map(toOutbox);

  if (entries.length > 0) {
    await insertMany(entries, session);
  }
};
