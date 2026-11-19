import { exploreVocabularyResponseSchema } from "../schemas/explore.schema.js";
import { SHELL_ALWAYS, answersShell } from "../services/shell-tag.js";
import { safeResponseFailAction } from "../services/safe-fail-action.js";
import { exploreVocabularyUseCase } from "../use-cases/explore-vocabulary.use-case.js";

const LABEL = "Explore vocabulary";

export const exploreVocabularyRoute = {
  method: "GET",
  path: "/grant-admin/explore/vocabulary",
  options: {
    ...answersShell(SHELL_ALWAYS),
    description:
      "Admin: the sources and paths an Explore query may name, kept for 60 seconds, 10 when a source is missing",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    response: {
      schema: exploreVocabularyResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  handler: () => exploreVocabularyUseCase(),
};
