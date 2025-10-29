const SHARED_PHASES = [
  {
    code: "PHASE_1",
    questions: {},
    stages: [
      {
        code: "STAGE_1",
        statuses: [
          {
            code: "NEW",
          },
        ],
      },
    ],
  },
];

const cloneSharedPhases = () => JSON.parse(JSON.stringify(SHARED_PHASES));

export const up = async (db) => {
  const collection = db.collection("grants");
  const grants = await collection.find().toArray();

  const operations = grants.map((grant) => {
    const phases = cloneSharedPhases();
    phases[0].questions = grant.questions ?? {};

    return {
      updateOne: {
        filter: { _id: grant._id },
        update: {
          $set: { phases },
          $unset: { questions: "" },
        },
      },
    };
  });

  if (operations.length > 0) {
    await collection.bulkWrite(operations);
  }
};

export const down = async (db) => {
  const collection = db.collection("grants");
  const grants = await collection.find().toArray();

  const operations = grants.map((grant) => {
    const questions = grant.phases?.[0]?.questions ?? null;
    const update =
      questions === null
        ? { $unset: { phases: "" } }
        : { $set: { questions }, $unset: { phases: "" } };
    return {
      updateOne: {
        filter: { _id: grant._id },
        update,
      },
    };
  });

  if (operations.length > 0) {
    await collection.bulkWrite(operations);
  }
};
