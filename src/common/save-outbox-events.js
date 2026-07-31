import { Outbox } from "../grants/models/outbox.js";
import { insertMany } from "../grants/repositories/outbox.repository.js";

// A publication may name its own segregation reference. Events whose data does
// not carry a clientRef or caseRef - the Payment Service message is one - cannot
// have one derived from the payload.
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
