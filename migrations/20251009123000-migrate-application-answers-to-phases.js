export const up = async (db) => {
  const applications = db.collection("applications");
  const grants = db.collection("grants");

  const cursor = applications.find({ answers: { $exists: true } });

  for await (const application of cursor) {
    const grant = await grants.findOne(
      { code: application.code },
      { projection: { phases: 1 } },
    );

    if (!grant?.phases?.length) {
      continue;
    }

    const firstPhase = grant.phases[0];
    const phases = [
      {
        code: firstPhase.code,
        answers: application.answers ?? {},
      },
    ];

    await applications.updateOne(
      { _id: application._id },
      {
        $set: { phases },
        $unset: { answers: "" },
      },
    );
  }
};

export const down = async (db) => {
  const applications = db.collection("applications");
  const cursor = applications.find({
    answers: { $exists: false },
    "phases.0.answers": { $exists: true },
  });

  for await (const application of cursor) {
    const firstPhase = application.phases?.[0];

    if (!firstPhase) {
      continue;
    }

    await applications.updateOne(
      { _id: application._id },
      {
        $set: { answers: firstPhase.answers ?? {} },
        $unset: { phases: "" },
      },
    );
  }
};
