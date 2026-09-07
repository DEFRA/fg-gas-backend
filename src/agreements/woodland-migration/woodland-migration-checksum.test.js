import { describe, expect, it } from "vitest";
import {
  checksum,
  createAgreementSourceChecksum,
  createLegacyEvidence,
  createMigrationSourceChecksum,
  deriveFirstGasClaimSequence,
  maximumLegacyClaimIdSequence,
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
    const migrationInput = {
      configVersion: "1.0.0",
      agreementChecksums: [agreementChecksum],
      claimIdCounterSeq: 4325,
    };
    const migrationChecksum = createMigrationSourceChecksum(migrationInput);

    expect(agreementChecksum).not.toBe(reordered);
    expect(migrationChecksum).toBe(
      createMigrationSourceChecksum(migrationInput),
    );
    expect(migrationChecksum).not.toBe(
      createMigrationSourceChecksum({
        ...migrationInput,
        configVersion: "2.0.0",
      }),
    );
    expect(migrationChecksum).not.toBe(
      createMigrationSourceChecksum({
        ...migrationInput,
        claimIdCounterSeq: 4326,
      }),
    );
  });

  it.each([
    [4325, 5000],
    [4000, 5000],
    [3999, 4000],
    [0, 1000],
    [9_999_999, 10_000_000],
    [9_999_000, 10_000_000],
    [9_007_199_254_739_999, 9_007_199_254_740_000],
  ])(
    "derives the first GAS claim sequence after legacy sequence %i",
    (legacySeq, firstGasSequence) => {
      const derived = deriveFirstGasClaimSequence(legacySeq);

      expect(derived).toBe(firstGasSequence);
      expect(Number.isSafeInteger(derived)).toBe(true);
      expect(Number.isSafeInteger(derived - 1)).toBe(true);
      expect(derived - (derived - 1)).toBe(1);
    },
  );

  it("rejects inputs that cannot produce an exactly representable handoff", () => {
    expect(maximumLegacyClaimIdSequence).toBe(9_007_199_254_739_999);
    expect(() => deriveFirstGasClaimSequence(9_007_199_254_740_000)).toThrow(
      "Legacy claim ID sequence cannot derive a safe GAS sequence",
    );
    expect(() => deriveFirstGasClaimSequence(1.5)).toThrow(
      "Legacy claim ID sequence cannot derive a safe GAS sequence",
    );
  });
});
