import { CloudEvent } from "../../common/cloud-event.js";
import { config } from "../../common/config.js";
import { applicationRefsOf } from "../../events/case-refs.js";
import { OUTBOX, defineEventType } from "../../events/event-types.js";

export const agreementStatusUpdate = defineEventType({
  name: "UpdateAgreementStatus",
  sentAs: `cloud.defra.${config.cdpEnvironment}.${config.serviceName}.agreement.status.update`,
  boxes: [OUTBOX],
  refs: ({ data }) => applicationRefsOf(data?.code, data?.clientRef),
});

export class UpdateAgreementStatusCommand extends CloudEvent {
  constructor(command) {
    super(
      "agreement.status.update",
      {
        clientRef: command.clientRef,
        code: command.code,
        status: command.status,
        agreementNumber: command.agreementNumber,
      },
      `${command.clientRef}-${command.code}`,
    );
  }
}
