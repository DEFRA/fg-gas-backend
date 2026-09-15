export const VARIANT_PATTERN = /^[a-z0-9-]+$/;

export const variantFileName = (file, variant) =>
  variant ? file.replace(/\.json$/, `.${variant}.json`) : file;

export const logConfigurationVariant = (configBroker, cdpEnvironment, log) => {
  const { variant, rawVariant } = configBroker;

  if (!rawVariant) {
    return;
  }

  if (cdpEnvironment === "prod" && rawVariant) {
    log.warn(
      `CONFIGURATION_VARIANT="${rawVariant}" ignored because ENVIRONMENT is prod — using unsuffixed definition files`,
    );
    return;
  }

  log.info(
    `Configuration variant "${variant}" active — selecting variant definition files`,
  );
};
