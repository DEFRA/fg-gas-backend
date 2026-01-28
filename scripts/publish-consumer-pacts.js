#!/usr/bin/env node

// Script to publish consumer pacts to the Pact Broker
import { Publisher } from "@pact-foundation/pact";
import { execSync } from "child_process";

const pactBrokerUrl =
  process.env.PACT_BROKER_BASE_URL ||
  "https://ffc-pact-broker.azure.defra.cloud";
const pactBrokerUsername = process.env.PACT_USER;
const pactBrokerPassword = process.env.PACT_PASS;

// Get git commit hash for version
const gitHash = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

const opts = {
  pactFilesOrDirs: ["tmp/pacts"],
  pactBroker: pactBrokerUrl,
  pactBrokerUsername: pactBrokerUsername,
  pactBrokerPassword: pactBrokerPassword,
  consumerVersion: gitHash,
};

console.log("Publishing consumer pacts to Pact Broker...");
console.log(`Broker: ${pactBrokerUrl}`);
console.log(`Version: ${gitHash}`);

const publisher = new Publisher(opts);

publisher
  .publishPacts()
  .then(() => {
    console.log("✅ Consumer pacts published successfully!");
  })
  .catch((error) => {
    console.error("❌ Failed to publish consumer pacts:", error);
    process.exit(1);
  });
