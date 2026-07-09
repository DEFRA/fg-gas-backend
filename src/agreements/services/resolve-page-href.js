import { resolveEffectParams } from "./effects/resolve-effect-params.js";

const applyTemplate = (urlTemplate, params) =>
  urlTemplate.replace(/{(\w+)}/g, (_match, key) => {
    if (params[key] === undefined) {
      throw new Error(
        `Unresolved param "${key}" in href template "${urlTemplate}"`,
      );
    }

    return params[key];
  });

export const resolvePageHref = async (href, context) => {
  if (typeof href === "string") {
    return href;
  }

  const params = await resolveEffectParams(href.params ?? {}, context);

  return applyTemplate(href.urlTemplate, params);
};
