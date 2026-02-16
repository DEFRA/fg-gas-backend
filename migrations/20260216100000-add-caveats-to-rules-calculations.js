/**
 * Add optional caveats array to rulesCalculations schema
 *
 * Changes:
 * - Add caveats property to rulesCalculations as an optional array
 * - Each caveat requires code and description, with optional dynamic metadata
 */

export const up = async (db) => {
  const query = { code: "frps-private-beta" };

  await db.collection("grants").updateOne(query, {
    $set: {
      "phases.0.questions.properties.rulesCalculations.properties.caveats": {
        type: "array",
        title: "Validation caveats",
        items: {
          type: "object",
          required: ["code", "description"],
          additionalProperties: false,
          properties: {
            code: {
              type: "string",
              title: "Caveat code",
            },
            description: {
              type: "string",
              title: "Caveat description",
            },
            metadata: {
              type: "object",
              title: "Caveat specific metadata",
              additionalProperties: true,
            },
          },
        },
      },
    },
  });
};
