import { findCwWorkflowVersions } from "../repositories/cw-workflows.repository.js";

// Not audited: it releases only what the unaudited Workflows list already shows.
export const listWorkflowVersionsUseCase = ({ code, actor }) =>
  findCwWorkflowVersions(code, { actor });
