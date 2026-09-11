import { createAgreementUseCase } from "./create-agreement.use-case.js";

// The internal command bus delivers a command envelope; the agreement creation
// input is carried in its data. Creation behaviour lives in the shared use case
// so the messaging interface does not leak beyond this adapter.
export const handleCreateAgreementCommandUseCase = (command) =>
  createAgreementUseCase(command.data);
