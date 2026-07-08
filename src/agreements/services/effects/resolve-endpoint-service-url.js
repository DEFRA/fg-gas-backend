export const resolveEndpointServiceUrl = (service) => {
  const envVar = `${service}_URL`;
  const url = process.env[envVar];

  if (!url) {
    throw new Error(
      `No URL configured for service "${service}" (expected env var ${envVar})`,
    );
  }

  return url;
};

// Every agreement definition's endpoints[].service must resolve to a real
// {SERVICE}_URL at startup.
export const validateEndpointServiceUrls = (definitions) => {
  const services = new Set(
    definitions
      .flatMap((definition) => definition.endpoints ?? [])
      .map((endpoint) => endpoint.service),
  );

  const missing = [...services].filter(
    (service) => !process.env[`${service}_URL`],
  );

  if (missing.length > 0) {
    const missingServicesUrls = missing
      .map((service) => `${service}_URL`)
      .join(", ");

    throw new Error(
      `Missing required endpoint URL env var(s): ${missingServicesUrls}`,
    );
  }
};
