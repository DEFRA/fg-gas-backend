import { Grant } from "../models/grant.js";
import { compileAnswersSchema } from "../services/schema-validation.service.js";
import { isGrantProcess } from "./transition-application.use-case.js";

// Arrival and an operator's Fetch Definitions hold a grant file to this same check.
export const checkGrantDefinition = (definition, version) =>
  Grant.fromDefinition(definition, version, {
    isKnownProcess: isGrantProcess,
    compileQuestions: compileAnswersSchema,
  });
