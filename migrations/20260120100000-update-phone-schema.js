export const up = async (db) => {
  const collection = db.collection("grants");
  const query = { code: "frps-private-beta" };

  const newPhoneSchema = {
    type: "string",
    pattern: "^\\+?[0-9\\s\\-()]+$",
    description: "Phone number",
  };

  // Update phone schema from object with mobile property to simple string
  await collection.updateOne(
    query,
    {
      $set: {
        "phases.$[phase].questions.$defs.Applicant.properties.business.properties.phone":
          newPhoneSchema,
      },
    },
    {
      arrayFilters: [{ "phase.code": "PRE_AWARD" }],
    },
  );
};
