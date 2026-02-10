// eslint-disable-next-line import-x/no-extraneous-dependencies
import { globSync } from "glob";
import { execSync } from "node:child_process";
import path from "node:path";
import { env } from "node:process";

const getLatestGitTagOrFallback = () => {
  try {
    return execSync("git describe --tags --abbrev=0 --always", {
      encoding: "utf8",
    }).trim();
  } catch {
    return "dev";
  }
};

/**
 * Build verification options for MessageProviderPact
 * @param {Object} config
 * @param {string} config.consumerName - Name of the consumer (e.g., "fg-cw-backend")
 * @returns {Object} Options for MessageProviderPact.verify()
 */
export const buildMessageVerifierOptions = ({ consumerName }) => {
  const useLocal = env.PACT_USE_LOCAL === "true";

  const baseOpts = {
    providerVersion: getLatestGitTagOrFallback(),
  };

  if (useLocal) {
    const pactDir =
      env.PACT_LOCAL_DIR || path.resolve(process.cwd(), "tmp/pacts");
    const pactUrls = globSync(`${pactDir}/*.json`, { nodir: true });
    return {
      ...baseOpts,
      pactUrls,
      publishVerificationResult: false, // no broker when local
    };
  }

  return {
    ...baseOpts,
    pactBrokerUrl:
      env.PACT_BROKER_BASE_URL || "https://ffc-pact-broker.azure.defra.cloud",
    consumerVersionSelectors: [{ consumer: consumerName, latest: true }],
    pactBrokerUsername: env.PACT_USER,
    pactBrokerPassword: env.PACT_PASS,
    publishVerificationResult: env.PACT_PUBLISH_VERIFICATION === "true",
  };
};
