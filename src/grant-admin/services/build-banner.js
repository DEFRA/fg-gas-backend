import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { resolveRefs } from "../../common/resolve-refs.js";
import { toApplicationContext } from "./application-context.js";

// A field whose reference cannot be resolved is dropped rather than allowed to
// take the page down with it. An answer a grant expects but an application has
// never been asked is a gap in one line of a header, not a reason to refuse the
// entitlements underneath it.
const resolveText = async (field, context, name) => {
  try {
    return { ...field, text: await resolveRefs(field.text, { context }) };
  } catch (err) {
    logger.warn(
      { err, field: name },
      `Banner field "${name}" could not be resolved`,
    );

    return undefined;
  }
};

const resolveSummary = async (summary = {}, context) => {
  const entries = await Promise.all(
    Object.entries(summary).map(async ([name, field]) => [
      name,
      await resolveText(field, context, name),
    ]),
  );

  return Object.fromEntries(entries.filter(([, field]) => field !== undefined));
};

const findBanner = (grant, page) => grant.pages?.[page]?.details?.banner;

const withTitle = (title) => (title ? { title } : {});

/**
 * The banner a grant configures for one of its pages, resolved against an
 * application.
 *
 * A grant that configures no banner for the page has no such page: there is
 * nothing to head it with, and a page headed by nothing tells a case officer
 * less than an honest 404 does. So this refuses rather than answering with a
 * header-shaped hole.
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
