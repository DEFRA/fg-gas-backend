import { CloudEvent } from "../../common/cloud-event.js";

import { config } from "../../common/config.js";
import { caseRefsOf } from "../../events/case-refs.js";
import { OUTBOX, defineEventType } from "../../events/event-types.js";

export const claimSubmitted = defineEventType({
  name: "ClaimSubmitted",
  sentAs: `cloud.defra.${config.cdpEnvironment}.${config.serviceName}.claim.submitted`,
  boxes: [OUTBOX],
  refs: ({ data }) => caseRefsOf(data?.workflowCode, data?.caseRef),
});

export class ClaimSubmittedEvent extends CloudEvent {
  constructor({ claim, claimId }) {
    const { metadata } = claim;
    super(
      "claim.submitted",
      {
        caseRef: metadata.clientRef,
        workflowCode: metadata.grantCode,
        claims: [
          {
            gasClaimId: claimId,
            clientClaimRef: claim.clientClaimRef,
            claimCode: claim.claimCode,
            claimAmountPence: claim.claim.totalClaimAmountPence,
            sbi: metadata.sbi,
            status: "SUBMITTED",
            submittedAt: claim.createdAt,
          },
        ],
      },
      `${metadata.clientRef}-${metadata.grantCode}`,
    );
  }
}
