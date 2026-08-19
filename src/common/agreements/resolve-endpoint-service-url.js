// Distinguishes local configuration faults from invalid shared config.
export class EndpointServiceUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = "EndpointServiceUrlError";
  }
}

const stripOuterQuotes = (value) =>
  value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;

const resolveEnvReferences = (value) =>
  value.replace(/\$\{([^}]+)\}/g, (_match, name) => {
    if (process.env[name] === undefined) {
      throw new EndpointServiceUrlError(
        `Environment variable ${name} referenced in service headers is not defined`,
      );
    }

    return process.env[name];
  });

const parseHeader = (value) => {
  const separator = value.indexOf(":");
  if (separator === -1) {
    throw new EndpointServiceUrlError("Invalid service header format");
  }

  return [
    value.slice(0, separator).trim(),
    resolveEnvReferences(value.slice(separator + 1).trim()),
  ];
};

export const resolveEndpointServiceHeaders = (service) => {
  const value = process.env[`${service}_HEADERS`];

  return value
    ? Object.fromEntries(
        stripOuterQuotes(value)
          .split(",")
          .map((header) => parseHeader(stripOuterQuotes(header.trim()))),
      )
    : {};
};

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
