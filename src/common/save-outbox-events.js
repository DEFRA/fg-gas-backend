import { Outbox } from "../grants/models/outbox.js";
import { insertMany } from "../grants/repositories/outbox.repository.js";

// Publications may supply an explicit outbox segregation reference when the
// generic event-data rules cannot derive one. Payment events group by Agreement
// Number, which is nested inside the Payment Service payload.
export const saveOutboxEvents = async (publications, session) => {
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
