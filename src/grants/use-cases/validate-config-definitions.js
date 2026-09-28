import { checkAgreementDefinition } from "../../agreements/use-cases/compile-agreement-definition.js";
import { checkDefinition as checkRegisteredDefinition } from "../../common/config-broker/definition-checks.js";
import { logger } from "../../common/logger.js";
import { fetchConfigFile } from "../../common/s3-client.js";
import { Grant } from "../models/grant.js";

// Building each model is the check: every one throws on a definition its context cannot
// use. Called directly rather than through the loaders, so nothing is cached and no fetch
// status is written - we are proving a version is usable, not putting it into service.
const checks = {
  grant: ({ definition, version }) => Grant.fromDefinition(definition, version),
  agreement: ({ definition, grantCode, version }) =>
    checkAgreementDefinition(definition, grantCode, version),
  payment: (context) => checkRegisteredDefinition("payment", context),
};

const checkDefinition = async ({
  definitionType,
  s3Key,
  s3Bucket,
  grantCode,
  version,
}) => {
  const definition = await fetchConfigFile(s3Bucket, s3Key);

  try {
    checks[definitionType]({ definition, grantCode, version });
  } catch (error) {
    // The error is interpolated, not passed as a field. A Boom error serialises to
    // error.output, error.isBoom and friends, which do not match the CDP log schema, and a
    // log that does not match is rejected whole rather than trimmed. event.action is in the
    // schema, so it stays.
    logger.error(
      { event: { action: "config-definition-check-failed" } },
      `The ${definitionType} definition for ${grantCode}@${version} cannot be used: ${error.name}: ${error.message}`,
    );
    throw error;
  }
};

// Run before the version is recorded, so a definition nothing can use never becomes
// something a grant, agreement or payment later resolves to. Stops at the first failure.
// The error keeps its own type, so the caller can still tell a bad definition from a bad
// S3.
export const validateConfigDefinitions = async ({
  grantCode,
  version,
  s3Bucket,
  s3Keys,
}) => {
  for (const definitionType of ["grant", "agreement", "payment"]) {
    const s3Key = s3Keys[definitionType];

    if (s3Key) {
      await checkDefinition({
        definitionType,
        s3Key,
        s3Bucket,
        grantCode,
        version,
      });
    }
  }
};
