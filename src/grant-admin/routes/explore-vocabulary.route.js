import {
  exploreVocabularyHeadersSchema,
  exploreVocabularyResponseSchema,
} from "../schemas/explore.schema.js";
import { SHELL_ALWAYS, answersShell } from "../services/shell-tag.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";
import { exploreVocabularyUseCase } from "../use-cases/explore-vocabulary.use-case.js";

const LABEL = "Explore vocabulary";

export const exploreVocabularyRoute = {
  method: "GET",
  path: "/grant-admin/explore/vocabulary",
  options: {
    ...answersShell(SHELL_ALWAYS),
    description:
      "Admin: the sources and paths an Explore query may name, kept for 60 seconds per set of roles, 10 when a source is missing",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: {
      headers: exploreVocabularyHeadersSchema,
      failAction: safeFailAction(LABEL),
    },
    response: {
      schema: exploreVocabularyResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  handler: (request) =>
    exploreVocabularyUseCase({ roles: request.headers["x-actor-roles"] }),
};
