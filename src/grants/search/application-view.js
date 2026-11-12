import { mergeAnswers } from "../models/application.js";

// What a grant's declared search paths are read against.
export const applicationViewOf = ({ phases }) => ({
  answers: mergeAnswers(phases),
});
