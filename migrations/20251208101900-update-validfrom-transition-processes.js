export const up = async (db) => {
  const grants = await db.collection("grants").find({}).toArray();

  for (const grant of grants) {
    if (grant.phases) {
      for (const phase of grant.phases) {
        if (phase.stages) {
          for (const stage of phase.stages) {
            if (stage.statuses) {
              stage.statuses = stage.statuses.map((status) => {
                if (status.validFrom && Array.isArray(status.validFrom)) {
                  // Get the processes from the status level
                  const statusLevelProcesses = status.processes || [];

                  const newValidFrom = status.validFrom.map((fromCode) => {
                    // APPLICATION_REJECTED should always have empty processes
                    if (fromCode === "APPLICATION_REJECTED") {
                      return {
                        code: fromCode,
                        processes: [],
                      };
                    }

                    return {
                      code: fromCode,
                      processes: statusLevelProcesses,
                    };
                  });

                  return {
                    code: status.code,
                    validFrom: newValidFrom,
                  };
                }

                return status;
              });
            }
          }
        }
      }
    }

    await db
      .collection("grants")
      .updateOne({ _id: grant._id }, { $set: { phases: grant.phases } });
    console.log(`Updated grant: ${grant.code}`);
  }

  console.log("Migration completed successfully");
};
