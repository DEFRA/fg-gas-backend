export const up = async (db) => {
  const collection = db.collection("grants");
  const grant = await collection.findOne({ code: "frps-private-beta" });

  if (grant) {
    {
      const phase = grant.phases.find((p) => p.code === "PRE_AWARD");
      const stage = phase.stages.find((s) => s.code === "REVIEW_OFFER");
      const status = stage.statuses.find((st) => st.code === "OFFERED");
      status.entryProcesses = ["STORE_AGREEMENT_CASE"];
    }

    {
      const phase = grant.phases.find((p) => p.code === "AWARD_AND_MONITORING");
      const stage = phase.stages.find((s) => s.code === "MONITORING");
      const status = stage.statuses.find((st) => st.code === "OFFER_ACCEPTED");
      if (!status) {
        stage.statuses.push({
          code: "OFFER_ACCEPTED",
          validFrom: ["PRE_AWARD:REVIEW_OFFER:OFFERED"],
          entryProcesses: ["UPDATE_AGREEMENT_CASE"],
        });
      } else {
        status.entryProcesses = ["UPDATE_AGREEMENT_CASE"];
      }
    }
    {
      const newStage = {
        code: "REVIEW_OFFER",
        statuses: [
          {
            code: "OFFERED",
            source: "CW",
            mappedTo: "::OFFERED",
          },
          {
            code: "OFFER_IN_REVIEW",
            source: "CW",
            mappedTo: "::OFFER_IN_REVIEW",
          },
          {
            code: "OFFER_SENT",
            source: "CW",
            mappedTo: "::OFFER_SENT",
          },
          {
            code: "WITHDRAWAL_REQUESTED",
            source: "CW",
            mappedTo: "::WITDRAWAL_REQUESTED",
          },
          {
            code: "accepted",
            source: "AS",
            mappedTo: "AWARD_AND_MONITORING:MONITORING:OFFER_ACCEPTED",
          },
          {
            code: "rejected",
            source: "AS",
            mappedTo: "::OFFER_REJECTED",
          },
          {
            code: "withdrawn",
            source: "AS",
            mappedTo: "::OFFER_WITHDRAWN",
          },
        ],
      };
      const phase = grant.externalStatusMap.phases.find(
        (p) => p.code === "PRE_AWARD",
      );
      const stage = phase.stages.find((s) => s.code === "REVIEW_OFFER");
      if (!stage) phase.stages.push(newStage);
    }

    await collection.updateOne({ code: "frps-private-beta" }, { $set: grant });
  }
};
