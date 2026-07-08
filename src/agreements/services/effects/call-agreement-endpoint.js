import Boom from "@hapi/boom";
import { wreck } from "../../../common/wreck.js";
import { resolveEndpointServiceUrl } from "./resolve-endpoint-service-url.js";

const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX = 300;

const isSuccessStatus = (statusCode) =>
  statusCode >= HTTP_SUCCESS_MIN && statusCode < HTTP_SUCCESS_MAX;

const buildUrl = (baseUrl, path) => {
  const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBaseUrl}${cleanPath}`;
};

const sendRequest = async (endpoint, url, body) => {
  try {
    return await wreck.request(endpoint.method, url, {
      headers: { "Content-Type": "application/json" },
      payload: body,
      json: true,
    });
  } catch (error) {
    throw Boom.badGateway(
      `Failed to call endpoint "${endpoint.code}": ${error.message}`,
    );
  }
};

// Status is checked before the body is read so a non-2xx response always
// surfaces its status code, even when the error body itself isn't valid
// JSON (e.g. a proxy timeout page) and would otherwise fail to parse.
const performRequest = async (endpoint, url, body) => {
  const response = await sendRequest(endpoint, url, body);

  if (!isSuccessStatus(response.statusCode)) {
    throw Boom.badGateway(
      `Endpoint "${endpoint.code}" returned non-success status: ${response.statusCode}`,
    );
  }

  try {
    return await wreck.read(response, { json: true });
  } catch (error) {
    throw Boom.badGateway(
      `Failed to parse response from endpoint "${endpoint.code}": ${error.message}`,
    );
  }
};

// Calls an endpoint configured on an agreement definition (endpoint.code
// looked up by the caller), by convention: {endpoint.service}_URL + endpoint.path.
// params.PATH is accepted for shape-parity with other consumers of this
// endpoint config but isn't substituted into the URL yet - no current
// endpoint needs it.
export const callAgreementEndpoint = async (endpoint, params = {}) => {
  const baseUrl = resolveEndpointServiceUrl(endpoint.service);
  const url = buildUrl(baseUrl, endpoint.path);

  return performRequest(endpoint, url, params.BODY ?? {});
};
