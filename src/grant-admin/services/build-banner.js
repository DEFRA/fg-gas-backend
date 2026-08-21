import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import {
  resolveRefs,
  UnresolvedReferenceError,
} from "../../common/resolve-refs.js";
import { toApplicationContext } from "./application-context.js";

const renderableTypes = new Set(["string", "number", "boolean"]);

const isRenderable = (text) =>
  text instanceof Date || renderableTypes.has(typeof text);

const drop = (name, reason) => {
  logger.warn({ field: name, ...reason }, `Banner field "${name}" was dropped`);

  return undefined;
};

const requireRenderable = (text, field, name) => {
  if (isRenderable(text)) {
    return { ...field, text };
  }

  throw Boom.badImplementation(
    `Banner field "${name}" reference "${field.text}" resolves to ${Array.isArray(text) ? "an array" : "an object"}`,
  );
};

// Answers vary from grant to grant so nulls can happen.
// anything else, a definition pointing to something that doesnt exist and will not
// parse, is wrong. Raise so it can be fixed/debugged.
const resolveText = async (field, context, name) => {
  let text;

  try {
    text = await resolveRefs(field.text, { context });
  } catch (err) {
    if (err instanceof UnresolvedReferenceError) {
      return drop(name, { err });
    }

    throw err;
  }

  if (text === null) {
    return drop(name, { resolved: "null" });
  }

  return requireRenderable(text, field, name);
};

const resolveSummary = async (summary, context) => {
  const entries = await Promise.all(
    Object.entries(summary ?? {}).map(async ([name, field]) => [
      name,
      await resolveText(field, context, name),
    ]),
  );

  return Object.fromEntries(entries.filter(([, field]) => field !== undefined));
};

const findBanner = (grant, page) => grant.pages?.[page]?.details?.banner;

const withTitle = (title) => (title ? { title } : {});

/**
 * Grants with no banner are not configured for this page - 404 rather than leaving a
 * broken page for case worker.
 */
export const buildBanner = async ({ grant, application, page }) => {
  const banner = findBanner(grant, page);

  if (!banner) {
    throw Boom.notFound(`Grant "${grant.code}" configures no "${page}" page`);
  }

  const context = toApplicationContext(application);

  return {
    ...withTitle(await resolveText(banner.title, context, "title")),
    summary: await resolveSummary(banner.summary, context),
  };
};
