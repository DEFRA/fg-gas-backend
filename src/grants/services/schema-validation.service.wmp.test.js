import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateAnswersAgainstSchema } from "./schema-validation.service.js";

const loadFixture = (relativePath) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"),
  );

describe("validateAnswersAgainstSchema — WMP fixtures", () => {
  const request = loadFixture(
    "../../../test/fixtures/wmp/wmp-sample-application-request.json",
  );
  const grant = loadFixture("../../../test/fixtures/wmp/woodland.json");
  const schema = grant.phases[0].questions;
  const { clientRef } = request.metadata;

  it("validates the sample application against the woodland PHASE_PRE_AWARD schema", () => {
    const result = validateAnswersAgainstSchema(
      clientRef,
      schema,
      request.answers,
    );

    expect(result).toMatchObject({
      businessDetailsUpToDate: true,
      landRegisteredWithRpa: true,
      appLandHasExistingWmp: true,
      existingWmps: "www",
      fcTeamCode: "SOUTH_WEST",
      totalHectaresAppliedFor: 195.246,
      hectaresTenOrOverYearsOld: 42,
      hectaresUnderTenYearsOld: 25,
    });
  });
});
