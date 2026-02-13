import { globSync } from "glob";
import { execSync } from "node:child_process";
import path from "node:path";
import { env } from "node:process";

function getLatestGitTagOrFallback() {
  return execSync("git describe --tags --abbrev=0 --always", {
    encoding: "utf8",
  }).trim();
}

export function buildVerifierOptions({
  providerBaseUrl,
  providerName,
  stateHandlers,
  extra = {},
}) {
  const useLocal = env.PACT_USE_LOCAL === "true";

  const baseOpts = {
    provider: providerName,
    providerBaseUrl,
    stateHandlers,
    providerVersion: getLatestGitTagOrFallback(),
    ...extra, // let individual tests add/override
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
    pactBrokerUrl: env.PACT_BROKER_BASE_URL,
    consumerVersionSelectors: [
      { consumer: "grants-ui", latest: true },
      { consumer: "fg-cw-backend", latest: true },
    ],
    pactBrokerUsername: env.PACT_USER,
    pactBrokerPassword: env.PACT_PASS,
    publishVerificationResult: env.PACT_PUBLISH_VERIFICATION === "true",
    failIfNoPactsFound: true,
  };
}
