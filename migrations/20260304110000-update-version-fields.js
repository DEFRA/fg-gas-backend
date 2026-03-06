/**
 * Update version fields across action and agreement schemas
 *
 * Changes:
 * - ApplicationAction.version: change from integer to string
 * - ApplicationAgreement.version: change from integer to string
 * - PaymentAction: add optional version property (string)
 */

export const up = async (db) => {
  const query = { code: "frps-private-beta" };
  const defsPath = "phases.0.questions.$defs";

  await db.collection("grants").updateOne(query, {
    $set: {
      [`${defsPath}.ApplicationAction.properties.version`]: {
        type: "string",
        title: "Action version",
      },
      [`${defsPath}.ApplicationAgreement.properties.version`]: {
        type: "string",
        title: "Action version",
      },
      [`${defsPath}.PaymentAction.properties.version`]: {
        type: "string",
        title: "Action version",
      },
    },
  });
};
