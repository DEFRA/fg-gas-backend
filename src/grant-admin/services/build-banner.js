import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { resolveRefs } from "../../common/resolve-refs.js";
import { toApplicationContext } from "./application-context.js";

const renderableTypes = ["string", "number", "boolean"];

const isRenderable = (text) =>
  text instanceof Date || renderableTypes.includes(typeof text);

const drop = (name, reason) => {
  logger.warn({ field: name, ...reason }, `Banner field "${name}" was dropped`);

  return undefined;
};

const resolveText = async (field, context, name) => {
  let text;

  try {
    text = await resolveRefs(field.text, { context });
  } catch (err) {
    return drop(name, { err });
  }

  return isRenderable(text)
    ? { ...field, text }
    : drop(name, { resolved: typeof text });
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
