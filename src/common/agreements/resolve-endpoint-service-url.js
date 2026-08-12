// A deployment gap, not a defect in the published definition: the same config
// is fine on an instance that has the env var. Typed so the loader can tell it
// apart from config that is genuinely broken and must never record it against
// the shared config version.
export class EndpointServiceUrlError extends Error {
  constructor(message, missingServices) {
    super(message);
    this.name = "EndpointServiceUrlError";
    this.missingServices = missingServices;
  }
}

export const resolveEndpointServiceUrl = (service) => {
  const envVar = `${service}_URL`;
  const url = process.env[envVar];

  if (!url) {
    throw new EndpointServiceUrlError(
      `No URL configured for service "${service}" (expected env var ${envVar})`,
      [service],
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

// Every loaded Agreement definition endpoint service must resolve to a real
// {SERVICE}_URL before the definition is cached.
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
      missing,
    );
  }
};
