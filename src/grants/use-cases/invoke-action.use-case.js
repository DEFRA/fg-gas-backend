import Boom from "@hapi/boom";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { wreck } from "../../common/wreck.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";

export const invokeActionUseCase = async ({
  code,
  name,
  method,
  payload,
  params,
}) => {
  logger.debug(
    `Invoke action for grant ${code} with name ${name} and method ${method} `,
  );

  const grant = await findGrantByCodeUseCase(code);

  const action = grant.actions.find(
    (e) => e.method === method && e.name === name,
  );

  if (!action) {
    throw Boom.badRequest(
      `Grant with code "${code}" has no ${method} action named "${name}"`,
    );
  }

  let url = parameterisedUrl(params, action.url, code);

  url = updateUrlForEnvironment(url);

  let response;
  if (method === "GET") {
    response = await wreck.get(url, {
      json: true,
    });
  } else if (method === "POST") {
    response = await wreck.post(url, {
      payload,
      json: true,
    });
  } else {
    throw Boom.badRequest(
      `Unsupported method ${method} for action named "${name}"`,
    );
  }

  logger.debug(
    `Finished: Invoke action for grant ${code} with name ${name} and method ${method} `,
  );

  return response.payload;
};

// Keep the existing helper functions unchanged
const parameterisedUrl = (params, url, code) => {
  let { queryParams, url: newUrl } = updateUrlAndExtractQueryParam(
    params,
    code,
    url,
  );
  errorIfUnassignedPlaceholders(newUrl, code);
  newUrl = addQueryParams(queryParams, newUrl);

  return newUrl;
};

const errorIfUnassignedPlaceholders = (url, code) => {
  const unresolvedPlaceholders = url.match(/(?<=\/)\$[a-zA-Z0-9_]+/g);

  if (unresolvedPlaceholders) {
    throw Boom.badRequest(
      `Grant with code "${code}" has unresolved placeholders in the URL: ${unresolvedPlaceholders.join(", ")}`,
    );
  }
};

const addQueryParams = (queryParams, newUrl) => {
  if (Object.keys(queryParams).length > 0) {
    const queryString = new URLSearchParams(queryParams).toString();
    newUrl += `?${queryString}`;
  }
  return newUrl;
};

const updateUrlAndExtractQueryParam = (params, code, url) => {
  const queryParams = {
    code: encodeURIComponent(code),
  };

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`$${key}`)) {
        url = url.replace(`$${key}`, encodeURIComponent(value));
      } else {
        queryParams[key] = value;
      }
    });
  }
  return { queryParams, url };
};

const updateUrlForEnvironment = (url) => {
  return url.replace("%ENVIRONMENT%", config.cdpEnvironment);
};
