import { logger } from "../../common/logger.js";
import { publicVocabulary } from "../explore/vocabulary.js";
import {
  keptVocabulary,
  loadExploreValues,
  loadExploreVocabulary,
} from "./load-explore-vocabulary.js";

const build = async () => {
  const [loaded, values] = await Promise.all([
    loadExploreVocabulary(),
    loadExploreValues(),
  ]);

  return {
    vocabulary: publicVocabulary(loaded, values),
    failed: loaded.unavailable.size > 0,
  };
};

// The sources and paths a query may name, closed paths with their known
// values, for the editor. A source whose service didn't answer is left out.
export const exploreVocabularyUseCase = async () => {
  const vocabulary = await keptVocabulary(build);

  logger.info(`Explore vocabulary (${vocabulary.sources.length} sources)`);

  return vocabulary;
};
