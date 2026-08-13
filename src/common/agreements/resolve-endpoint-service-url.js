// Distinguishes local configuration faults from invalid shared config.
export class EndpointServiceUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = "EndpointServiceUrlError";
  }
}

export const resolveEndpointServiceUrl = (service) => {
  const envVar = `${service}_URL`;
  const url = process.env[envVar];

  if (!url) {
    throw new EndpointServiceUrlError(
      `No URL configured for service "${service}" (expected env var ${envVar})`,
    );
  }

  return url;
};

const processEndpointsFor = (definition) =>
  Object.values(definition.processDefinitions ?? {})
    .filter(({ type }) => type === "endpoint")
    .map(({ endpoint }) => endpoint);

const endpointsFor = (definition) => [
  ...(definition.endpoints ?? []),
  ...processEndpointsFor(definition),
];

export const validateEndpointServiceUrls = (definitions) => {
  const services = new Set(
    definitions
      .flatMap((definition) => endpointsFor(definition))
      .map((endpoint) => endpoint.service),
  );

  const missing = [...services].filter(
    (service) => !process.env[`${service}_URL`],
  );

  if (missing.length > 0) {
    const missingServicesUrls = missing
      .map((service) => `${service}_URL`)
      .join(", ");

    throw new EndpointServiceUrlError(
      `Missing required endpoint URL env var(s): ${missingServicesUrls}`,
    );
  }
};
