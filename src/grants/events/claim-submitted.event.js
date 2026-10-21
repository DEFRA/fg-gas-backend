import { CloudEvent } from "../../common/cloud-event.js";

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
