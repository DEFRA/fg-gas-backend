/**
 * Make line2 optional in Applicant.business.address object
 *
 * Changes:
 * - Change line2 type from "string" to ["string", "null"] to make it optional
 * - Remove line2 from required fields in Applicant.business.address
 * - This is a non-breaking change - existing data is not modified
 */

export const up = async (db) => {
  const query = { code: "frps-private-beta" };

  // Update the grant definition - make line2 optional and remove from required array
  await db.collection("grants").updateOne(query, {
    $set: {
      "phases.0.questions.$defs.Applicant.properties.business.properties.address.properties.line2":
        {
          type: ["string", "null"],
          description: "Address line 2",
        },
      "phases.0.questions.$defs.Applicant.properties.business.properties.address.required":
        ["line1", "city", "postalCode"],
    },
  });
};
