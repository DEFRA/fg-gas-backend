import Boom from "@hapi/boom";
import { resolveProcessMapping } from "../../../common/mapping/resolve-process-mapping.js";
import {
  EndpointServiceUrlError,
  resolveEndpointServiceHeaders,
  resolveEndpointUrl,
} from "../../../common/resolve-endpoint-service-url.js";
import { wreck } from "../../../common/wreck.js";
import { ReferenceDataSet } from "../../models/reference-data-set.js";

const describe = ({ name }) => `reference data "${name}"`;

const resolveAddress = (endpoint, declaration) => {
  try {
    return {
      url: resolveEndpointUrl(endpoint),
      headers: resolveEndpointServiceHeaders(endpoint.service),
    };
  } catch (error) {
    if (error instanceof EndpointServiceUrlError) {
      throw Boom.badImplementation(
        `Cannot call ${describe(declaration)}: ${error.message}`,
      );
    }

    throw error;
  }
};

const fetchResponse = async (endpoint, declaration) => {
  const { url, headers } = resolveAddress(endpoint, declaration);

  try {
    const { payload } = await wreck.get(url, { headers, json: "force" });
    return payload;
  } catch (error) {
    throw Boom.badGateway(
      `Failed to fetch ${describe(declaration)} from ${endpoint.service}: ${error.message}`,
    );
  }
};

// The service answers in its own shape; the output Mapping turns it into
// items, with the response at $.response as an agreement process has.
export const loadEndpointReferenceData = async ({ grant, declaration }) => {
  const { endpoint, output } = grant.referenceDataCallFor(declaration);
  const response = await fetchResponse(endpoint, declaration);

  try {
    const items = await resolveProcessMapping(output.items, { response });

    return new ReferenceDataSet({ name: declaration.name, items });
  } catch (error) {
    throw Boom.badGateway(
      `${endpoint.service} answered ${describe(declaration)} with unusable items: ${error.message}`,
    );
  }
};
