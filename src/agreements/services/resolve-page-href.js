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

const resolveAction = async (context, { href, ...action }) => {
  const [resolvedAction, resolvedHref] = await Promise.all([
    resolveEffectParams(action, context),
    resolvePageHref(href, context),
  ]);

  return { ...resolvedAction, href: resolvedHref };
};

export const resolveActions = async (context, actions = []) =>
  Promise.all(actions.map((action) => resolveAction(context, action)));
