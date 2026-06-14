import { recordAgreementLifecyclePublicationIntent } from "./record-agreement-publication-intent.use-case.js";

export const emitAgreementLifecycleEventStep = ({ context }) => ({
  publication: recordAgreementLifecyclePublicationIntent({
    publication: context.publication,
  }),
});
