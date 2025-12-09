export const up = async (db) => {
  const collection = db.collection("grants");
  const grants = await collection.find().toArray();

  for (const grant of grants) {
    let changed = false;

    for (const phase of grant.phases || []) {
      for (const stage of phase.stages || []) {
        for (const status of stage.statuses || []) {
          const originalValidFrom = status.validFrom;

          if (!Array.isArray(originalValidFrom)) {
            continue;
          }

          const isAlreadyObjectForm = originalValidFrom.every(
            (v) => typeof v === "object" && v !== null && "code" in v,
          );

          let newValidFrom;
          if (isAlreadyObjectForm) {
            newValidFrom = originalValidFrom.map((v) => ({
              code: v.code,
              processes: Array.isArray(v.processes) ? v.processes : [],
            }));
          } else {
            const statusLevelProcesses = Array.isArray(status.processes)
              ? status.processes
              : [];

            newValidFrom = originalValidFrom.map((code) => ({
              code,
              processes: [...statusLevelProcesses],
            }));
          }

          if (
            grant.code === "frps-private-beta" &&
            status.code === "AGREEMENT_DRAFTED"
          ) {
            const targetCode =
              "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING";
            newValidFrom = newValidFrom.map((entry) => ({
              code: entry.code,
              processes:
                entry.code === targetCode ? ["STORE_AGREEMENT_CASE"] : [],
            }));
            changed = true;
          }

          // Determine if we changed anything compared to stored form
          const needsUpdate =
            !isAlreadyObjectForm ||
            JSON.stringify(originalValidFrom) !== JSON.stringify(newValidFrom);

          if (needsUpdate) {
            status.validFrom = newValidFrom;
            // Remove status-level processes to avoid ambiguity in the new model
            if (status.processes) delete status.processes;
            changed = true;
          }
        }
      }
    }

    if (changed) {
      await collection.updateOne(
        { _id: grant._id },
        {
          $set: {
            phases: grant.phases,
          },
        },
      );
    }
  }
};
