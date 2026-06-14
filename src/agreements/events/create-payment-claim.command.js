import { randomUUID } from "node:crypto";
import { config } from "../../common/config.js";
import { createPaymentClaimPayload } from "../models/payment-claim-payload.js";

export class CreatePaymentClaimCommand {
  constructor({ agreement, item, paymentClaim, version }) {
    const itemState = version.findItemState(item.agreementItemId);
    const referenceDate = version.createdAt ?? new Date().toISOString();

    this.id = randomUUID();
    this.source = config.serviceName;
    this.specversion = "1.0";
    this.type = config.sns.createPaymentType;
    this.time = new Date().toISOString();
    this.datacontenttype = "application/json";
    this.data = createPaymentClaimPayload({
      agreement,
      item,
      itemState,
      paymentClaim,
      referenceDate,
    });
    this.messageGroupId = `${item.clientRef}-${item.agreementCode}`;
  }
}
