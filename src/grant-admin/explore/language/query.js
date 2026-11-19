import { readProblem } from "../check.js";
import { SOURCES } from "./allowlist.js";
import { lex } from "./lex.js";
import { outlineProblem } from "./outline.js";
import { parse, sizeProblem } from "./parse.js";
import { readLiteral } from "./read.js";

const sourceNames = (vocabulary) =>
  SOURCES.filter(
    (name) => vocabulary.sources.has(name) || vocabulary.unavailable.has(name),
  );

const readTree = (tree, vocabulary) => {
  const result = readLiteral(tree, vocabulary);

  if (result.error) {
    return result;
  }

  const problem = readProblem(result.source, result.query, result.spans);

  return problem ? { error: problem } : { ...result, tree };
};

// A query's text to the Query, its source and its literal tree, or the first
// problem as { error: { message, at, end } }: its shape as the editor sees
// it, then the literal, then its meaning, then how its source can read it.
export const readQuery = (text, vocabulary) => {
  const tokens = lex(text);
  const outlined =
    sizeProblem(text, tokens) ??
    outlineProblem(text, tokens, sourceNames(vocabulary));

  if (outlined) {
    return { error: outlined };
  }

  const { tree, error } = parse(text, tokens);

  return error ? { error } : readTree(tree, vocabulary);
};
