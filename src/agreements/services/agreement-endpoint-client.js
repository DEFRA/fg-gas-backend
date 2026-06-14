import Boom from "@hapi/boom";
import { config } from "../../common/config.js";
import { wreck } from "../../common/wreck.js";

const serviceConfigs = {
  LAND_GRANTS: () => ({
    headers: config.landGrants.token
      ? { Authorization: `Bearer ${config.landGrants.token}` }
      : {},
    url: config.landGrants.uri,
  }),
};

const getServiceConfig = (service) => {
  const serviceConfig = serviceConfigs[service]?.();

  if (serviceConfig?.url) {
    return serviceConfig;
  }

  throw Boom.badRequest(
    `Agreement endpoint service "${service}" is not configured`,
  );
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
