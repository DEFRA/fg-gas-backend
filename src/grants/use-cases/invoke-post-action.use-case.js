import Boom from "@hapi/boom";
import { wreck } from "../../common/wreck.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";

export const invokePostActionUseCase = async ({
  code,
  name,
  payload,
  params,
}) => {
  const grant = await findGrantByCodeUseCase(code);

  const action = grant.actions.find(
    (e) => e.method === "POST" && e.name === name,
  );

  if (!action) {
    throw Boom.badRequest(
      `Grant with code "${code}" has no POST action named "${name}"`,
    );
  }

  const url = parameterizedUrl(params, action.url, code);

  const response = await wreck.post(url, {
    payload,
    json: true,
  });

  return response.payload;
};

function parameterizedUrl(params, url, code) {
  let { queryParams, url: newUrl } = updateUrlAndExtractQueryParam(params, url);

  errorIfUnassignedPlaceholders(newUrl, code);
  newUrl = addQueryParams(queryParams, newUrl);

  return newUrl;
}

function errorIfUnassignedPlaceholders(url, code) {
  const unresolvedPlaceholders = url.match(/\{([^}]+)\}/g);
  if (unresolvedPlaceholders) {
    const unresolvedKeys = unresolvedPlaceholders.map((placeholder) =>
      placeholder.slice(1, -1),
    );
    throw Boom.badRequest(
      `Grant with code "${code}" has unresolved placeholders in the URL: ${unresolvedKeys.join(", ")}`,
    );
  }
}

function addQueryParams(queryParams, newUrl) {
  if (Object.keys(queryParams).length > 0) {
    const queryString = new URLSearchParams(queryParams).toString();
    newUrl += `?${queryString}`;
  }
  return newUrl;
}

function updateUrlAndExtractQueryParam(params, url) {
  const queryParams = {};

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`{${key}}`)) {
        url = url.replace(`{${key}}`, encodeURIComponent(value));
      } else {
        queryParams[key] = value;
      }
    });
  }
  return { queryParams, url };
}
