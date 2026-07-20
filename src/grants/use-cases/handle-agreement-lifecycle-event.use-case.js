import {
  messageSource,
  saveInboxMessageUseCase,
} from "./save-inbox-message.use-case.js";

export const handleAgreementLifecycleEventUseCase = (event) =>
  saveInboxMessageUseCase(event, messageSource.AgreementService);
