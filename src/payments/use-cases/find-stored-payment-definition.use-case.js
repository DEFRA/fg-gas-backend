import { findStoredPaymentDefinition } from "../repositories/payment-definition.repository.js";

const NOT_STORED = { definition: null, storedBytes: null };

// The seam Grant Admin reads a stored Payment definition through. See
// docs/MODULE_BOUNDARIES.md.
export const findStoredPaymentDefinitionUseCase = async (
  { code, version },
  { maxBytes },
) =>
  (await findStoredPaymentDefinition({ code, version }, { maxBytes })) ??
  NOT_STORED;
