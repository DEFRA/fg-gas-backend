import { config } from "../../common/config.js";
import { saveEvents } from "../../events/index.js";
import { ClaimSubmittedEvent } from "../events/claim-submitted.event.js";

export const storeClaimCaseUseCase = async ({ claim, claimId }, session) => {
  await saveEvents(
    [
      {
        event: new ClaimSubmittedEvent({ claim, claimId }),
        target: config.sns.updateCaseStatusTopicArn,
      },
    ],
    session,
  );
};
