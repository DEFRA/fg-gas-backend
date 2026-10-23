import { findCwWorkflowVersions } from "../repositories/cw-actuators.repository.js";

// Not audited: it releases only what the unaudited Workflows list already shows.
export const listWorkflowVersionsUseCase = ({ code, actor }) =>
  findCwWorkflowVersions(code, { actor });
