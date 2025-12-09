export const up = async (db) => {
  const grants = await db.collection("grants").find({}).toArray();

  for (const grant of grants) {
    for (const phase of grant.phases) {
      for (const stage of phase.stages) {
        stage.statuses = stage.statuses.map((status) => {
          const newValidFrom = (status.validFrom || []).map((fromCode) => {
            // APPLICATION_REJECTED should always have empty processes
            if (fromCode === "APPLICATION_REJECTED") {
              return {
                code: fromCode,
                processes: [],
              };
            }

            return {
              code: fromCode,
              processes: status.processes || [],
            };
          });

          return {
            code: status.code,
            validFrom: newValidFrom,
          };
        });
      }
    }

    await db
      .collection("grants")
      .updateOne({ _id: grant._id }, { $set: { phases: grant.phases } });
    console.log(`Updated grant: ${grant.code}`);
  }

  console.log("Migration completed successfully");
};
