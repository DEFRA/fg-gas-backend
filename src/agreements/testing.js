// Explicit QA adapter surface. Production contexts must integrate through
// commands, events or HTTP rather than importing Agreement internals.
export { isGasManagedAgreementGrant } from "./services/agreement-ownership.js";
export { createAgreementUseCase } from "./use-cases/create-agreement.use-case.js";
export { handleUpdateAgreementStatusCommandUseCase } from "./use-cases/handle-update-agreement-status-command.use-case.js";
export { loadCurrentAgreementByNumber } from "./use-cases/load-current-agreement.js";
