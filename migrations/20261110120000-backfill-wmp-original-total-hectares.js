import { decimalPlaces } from "../src/common/decimal-places.js";
import { logger } from "../src/common/logger.js";

// FGP-1554: originalTotalHectares was added to the PA3 entitlement template
// after some woodland entitlements had been created. The field is resolved
// from the application only when an entitlement is created, so those
// entitlements have no value for it. This fills it in from the application's
// totalHectaresForSelectedParcels, which 20261109120000 has already rounded.

const CODE = "woodland";
const CLAIM_CODE = "ENT_CS_CAPITAL_PA3";
const FIELD = "originalTotalHectares";
const ANSWER = "totalHectaresForSelectedParcels";
const DECIMAL_PLACES = 4;

// Later phases win, as they do when an entitlement field is resolved.
const answerOf = (application) =>
  (application?.phases ?? []).reduce(
    (found, phase) => phase.answers?.[ANSWER] ?? found,
    undefined,
  );

const isStorable = (value) =>
  Number.isFinite(value) && decimalPlaces(value) <= DECIMAL_PLACES;

// Stored scaled, as entitlement decimals are.
const toStored = (value) => Math.round(value * 10 ** DECIMAL_PLACES);

const backfill = async (applications, entitlement) => {
  const { clientRef, id } = entitlement;
  const application = await applications.findOne(
    { code: CODE, clientRef },
    { projection: { phases: 1 } },
  );
  const answer = answerOf(application);

  if (!isStorable(answer)) {
    logger.warn(
      `Not backfilling ${FIELD} on entitlement ${id} (application ${clientRef}): ${ANSWER} is ${answer}`,
    );
    return null;
  }

  logger.info(
    `Backfilling ${FIELD} on entitlement ${id} (application ${clientRef}): ${answer}`,
  );

  return {
    updateOne: {
      filter: { _id: entitlement._id, [`data.${FIELD}`]: { $exists: false } },
      update: { $set: { [`data.${FIELD}`]: toStored(answer) } },
    },
  };
};

export const up = async (db) => {
  const applications = db.collection("applications");
  const entitlements = db.collection("entitlements");

  const missing = await entitlements
    .find(
      {
        code: CODE,
        claimCode: CLAIM_CODE,
        [`data.${FIELD}`]: { $exists: false },
      },
      { projection: { _id: 1, id: 1, clientRef: 1 } },
    )
    .sort({ clientRef: 1 })
    .toArray();

  const updates = [];
  for (const entitlement of missing) {
    const update = await backfill(applications, entitlement);
    if (update) {
      updates.push(update);
    }
  }

  const modifiedCount =
    updates.length > 0
      ? (await entitlements.bulkWrite(updates)).modifiedCount
      : 0;

  logger.info(
    `Backfilled ${FIELD} on ${modifiedCount} of ${missing.length} ${CODE} entitlements missing it`,
  );
};
