import { logger } from "../../common/logger.js";
import { rolesOf } from "../explore/access.js";
import { publicVocabulary } from "../explore/vocabulary.js";
import { callerMayQuery } from "./explore-access.js";
import {
  keptVocabulary,
  loadExploreValues,
  loadExploreVocabulary,
} from "./load-explore-vocabulary.js";

// The roles a vocabulary is drawn for, the same however GPA lists them.
const roleSetOf = (roles) =>
  [...new Set(rolesOf(roles) ?? [])]
    .sort((a, b) => a.localeCompare(b))
    .join(",");

const build = (roles) => async () => {
  const [loaded, values] = await Promise.all([
    loadExploreVocabulary(),
    loadExploreValues(),
  ]);

  return {
    vocabulary: publicVocabulary(loaded, values, callerMayQuery({ roles })),
    failed: loaded.unavailable.size > 0,
  };
};

// The sources and paths a query may name, closed paths with their known
// values, for the editor. A source whose service didn't answer, or that the
// caller's roles don't allow, is left out.
export const exploreVocabularyUseCase = async ({ roles }) => {
  const vocabulary = await keptVocabulary(
    JSON.stringify(roleSetOf(roles)),
    build(roles),
  );

  logger.info(`Explore vocabulary (${vocabulary.sources.length} sources)`);

  return vocabulary;
};
