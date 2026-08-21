import { preparePayment } from "./prepare-payment.js";

export const prepareAgreementPayment = async ({
  code,
  configVersion,
  agreement,
  execution,
}) => ({
  commitOperations: [
    {
      type: "create-agreement-payment",
      request: {
        paymentConfiguration: await preparePayment({
          code,
          configVersion,
          context: { agreement, execution },
        }),
      },
    },
  ],
});
