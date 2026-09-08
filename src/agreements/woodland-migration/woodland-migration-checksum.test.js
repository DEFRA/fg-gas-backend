import { describe, expect, it } from "vitest";
import {
  checksum,
  createAgreementSourceChecksum,
  createLegacyEvidence,
  createMigrationSourceChecksum,
} from "./woodland-migration-checksum.js";

describe("Woodland migration checksums", () => {
  it("is deterministic across object key order while preserving array order", () => {
    expect(checksum({ b: 2, a: { d: 4, c: 3 } })).toBe(
      checksum({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(checksum({ values: [1, 2] })).not.toBe(checksum({ values: [2, 1] }));
  });

  it("keeps an untouched copy of the source envelope", () => {
    const envelope = {
      agreement: { agreementNumber: "WMP0001" },
      grant: { code: "woodland" },
      version: { quantity: { $numberDecimal: "4.7500" } },
    };
    const evidence = createLegacyEvidence(envelope);

    envelope.version.quantity.$numberDecimal = "changed";

    expect(evidence).toMatchObject({
      source: "legacy-agreements",
      checksum: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      envelope: {
        version: { quantity: { $numberDecimal: "4.7500" } },
      },
    });
    expect(checksum(evidence.envelope)).toBe(evidence.checksum);
  });

  it("changes aggregate checksums with source order and configuration", () => {
    const agreementChecksum = createAgreementSourceChecksum({
      agreementNumber: "WMP0001",
      configVersion: "1.0.0",
      versionChecksums: ["sha256:first", "sha256:second"],
    });
    const reordered = createAgreementSourceChecksum({
      agreementNumber: "WMP0001",
      configVersion: "1.0.0",
      versionChecksums: ["sha256:second", "sha256:first"],
    });
    const migrationChecksum = createMigrationSourceChecksum({
      configVersion: "1.0.0",
      agreementChecksums: [agreementChecksum],
    });

    expect(agreementChecksum).not.toBe(reordered);
    expect(migrationChecksum).not.toBe(
      createMigrationSourceChecksum({
        configVersion: "2.0.0",
        agreementChecksums: [agreementChecksum],
      }),
    );
  });
});
