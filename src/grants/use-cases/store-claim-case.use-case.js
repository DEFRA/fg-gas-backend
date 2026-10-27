import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { saveEvents } from "../../events/index.js";
import { UpdateCaseSupplementaryDataCommand } from "../commands/update-case-supplementary-data.command.js";

const supplementaryClaimData = (claim, claimId, grant) => {
  const { totalClaimAmountPence, ...details } = claim.claim;
  const template = grant.findEntitlementTemplate(claim.claimCode);

  return {
    ...details,
    unit: template?.quantityUnit() ?? null,
    gasClaimId: claimId,
    clientClaimRef: claim.clientClaimRef,
    claimCode: claim.claimCode,
    claimAmountPence: totalClaimAmountPence,
    sbi: claim.metadata.sbi,
    status: "SUBMITTED",
    submittedAt: claim.createdAt,
  };
};

export const storeClaimCaseUseCase = async (
  { claim, claimId, grant },
  session,
) => {
  logger.info(
    `Queuing supplementary claim data for application "${claim.clientRef}" and grant "${claim.code}"`,
  );
  await saveEvents(
    [
      {
        event: new UpdateCaseSupplementaryDataCommand({
          caseRef: claim.clientRef,
          workflowCode: claim.code,
          supplementaryData: {
            targetNode: "claims",
            dataType: "ARRAY",
            key: "gasClaimId",
            data: supplementaryClaimData(claim, claimId, grant),
          },
        }),
        target: config.sns.updateCaseStatusTopicArn,
      },
    ],
    session,
  );
  logger.info(
    `Finished: Queuing supplementary claim data for application "${claim.clientRef}" and grant "${claim.code}"`,
  );
};
