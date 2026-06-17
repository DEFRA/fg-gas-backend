import Boom from "@hapi/boom";
import { wreck } from "../../common/wreck.js";

const resolveEnvVarReferences = (value) => {
  if (!value || typeof value !== "string") {
    return value;
  }

  return value.replace(/\$\{([^}]+)\}/g, (_match, envVarName) => {
    const envValue = process.env[envVarName];

    if (envValue === undefined) {
      throw Boom.badRequest(
        `Environment variable ${envVarName} referenced in Agreement endpoint headers but not defined`,
      );
    }

    return envValue;
  });
};

const stripOuterQuotes = (value) => {
  if (!value || typeof value !== "string") {
    return value;
  }

  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
};

const parseHeaders = (headersString) => {
  if (!headersString) {
    return {};
  }

  return stripOuterQuotes(headersString)
    .split(",")
    .reduce((headers, headerPair) => {
      const pair = stripOuterQuotes(headerPair.trim());
      const colonIndex = pair.indexOf(":");

      if (colonIndex === -1) {
        throw Boom.badRequest("Invalid Agreement endpoint header format");
      }

      return {
        ...headers,
        [pair.substring(0, colonIndex).trim()]: resolveEnvVarReferences(
          pair.substring(colonIndex + 1).trim(),
        ),
      };
    }, {});
};

const getServiceConfig = (service) => {
  const url = process.env[`${service}_URL`];

  if (!url) {
    throw Boom.badRequest(
      `No URL configured for Agreement endpoint service: ${service}`,
    );
  }

  return {
    headers: parseHeaders(process.env[`${service}_HEADERS`]),
    url,
  };
};

const replacePathParameters = ({ path, pathParams }) =>
  Object.entries(pathParams ?? {}).reduce(
    (currentPath, [key, value]) =>
      currentPath.replace(`{${key}}`, encodeURIComponent(String(value))),
    path,
  );

const buildUrl = ({ path, pathParams, serviceUrl }) =>
  new URL(replacePathParameters({ path, pathParams }), serviceUrl).toString();

const shouldIncludePayload = (method, payload) =>
  !["GET", "HEAD"].includes(method) &&
  payload &&
  Object.keys(payload).length > 0;

const buildRequestOptions = ({ headers, method, params }) => {
  const options = {
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    json: true,
  };

  if (shouldIncludePayload(method, params.BODY)) {
    options.payload = params.BODY;
  }

  return options;
};

export const callAgreementEndpoint = async ({ endpoint, params = {} }) => {
  const { headers, url } = getServiceConfig(endpoint.service);
  const response = await wreck.request(
    endpoint.method,
    buildUrl({
      path: endpoint.path,
      pathParams: params.PATH,
      serviceUrl: url,
    }),
    buildRequestOptions({ headers, method: endpoint.method, params }),
  );

  return wreck.read(response, { json: true });
};
