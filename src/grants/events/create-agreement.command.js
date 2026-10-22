import { CloudEvent } from "../../common/cloud-event.js";
import { config } from "../../common/config.js";
import { applicationRefsOf } from "../../events/case-refs.js";
import { OUTBOX, defineEventType } from "../../events/event-types.js";

export const agreementCreate = defineEventType({
  name: "CreateAgreement",
  sentAs: `cloud.defra.${config.cdpEnvironment}.${config.serviceName}.agreement.create`,
  boxes: [OUTBOX],
  refs: ({ data }) => applicationRefsOf(data?.code, data?.clientRef),
});

export class CreateAgreementCommand extends CloudEvent {
  constructor(application) {
    super(
      "agreement.create",
      {
        clientRef: application.clientRef,
        code: application.code,
        currentConfigVersion: application.currentConfigVersion ?? null,
        identifiers: application.identifiers,
        metadata: application.metadata,
        answers: application.getAnswers(),
      },
      `${application.clientRef}-${application.code}`,
    );
  }
}
