import { describe, expect, it } from "vitest";
import { Position } from "./position.js";
import { Status } from "./status.js";

const position = Position.parse("PRE_AWARD:REVIEW:HELD");
const isKnownProcess = (process) =>
  ["GENERATE_OFFER", "ACCEPT_AGREEMENT"].includes(process);

const statusOf = (definition) =>
  new Status({ code: "HELD", ...definition }, { position, isKnownProcess });

describe("Status", () => {
  describe("processes", () => {
    it("runs the processes of its validFrom entries", () => {
      const status = statusOf({
        validFrom: [
          { code: "RECEIVED", processes: ["GENERATE_OFFER"] },
          { code: "IN_REVIEW", processes: ["ACCEPT_AGREEMENT"] },
        ],
      });

      expect(status.processesOnEntering).toEqual([
        "GENERATE_OFFER",
        "ACCEPT_AGREEMENT",
      ]);
    });

    it.each([
      ["missing", undefined],
      ["empty", []],
    ])(
      "accepts validFrom alongside its own processes when they are %s",
      (_label, processes) => {
        expect(() =>
          statusOf({
            validFrom: [{ code: "RECEIVED", processes: ["GENERATE_OFFER"] }],
            processes,
          }),
        ).not.toThrow();
      },
    );

    it.each([
      ["a list", ["GENERATE_OFFER"]],
      ["a single string", "GENERATE_OFFER"],
    ])(
      "rejects its own processes given as %s when it has validFrom, as they would never run",
      (_label, processes) => {
        expect(() =>
          statusOf({
            validFrom: [{ code: "RECEIVED", processes: [] }],
            processes,
          }),
        ).toThrow(
          'status "PRE_AWARD:REVIEW:HELD" has its own processes, which would never run because it has validFrom',
        );
      },
    );

    it.each([
      ["no validFrom", {}],
      ["an empty validFrom", { validFrom: [] }],
    ])("runs its own processes when it has %s", (_label, definition) => {
      const status = statusOf({
        ...definition,
        processes: ["ACCEPT_AGREEMENT"],
      });

      expect(status.processesOnEntering).toEqual(["ACCEPT_AGREEMENT"]);
    });

    it.each([
      ["missing", undefined],
      ["a single string", "UNKNOWN"],
    ])("runs nothing when its own processes are %s", (_label, processes) => {
      expect(statusOf({ processes }).processesOnEntering).toEqual([]);
    });

    it.each([
      ["an object", {}],
      ["a number", 3],
    ])("rejects its own processes given as %s", (_label, processes) => {
      expect(() => statusOf({ processes })).toThrow(
        'status "PRE_AWARD:REVIEW:HELD" has processes that are not a list',
      );
    });

    it("rejects a validFrom process that is not known", () => {
      expect(() =>
        statusOf({ validFrom: [{ code: "RECEIVED", processes: ["UNKNOWN"] }] }),
      ).toThrow(
        'status "PRE_AWARD:REVIEW:HELD" runs unknown process "UNKNOWN"',
      );
    });

    it("rejects its own process that is not known", () => {
      expect(() => statusOf({ processes: ["UNKNOWN"] })).toThrow(
        'status "PRE_AWARD:REVIEW:HELD" runs unknown process "UNKNOWN"',
      );
    });
  });

  describe("assertValidFromResolvesIn", () => {
    const positions = [
      Position.parse("PRE_AWARD:REVIEW:RECEIVED"),
      Position.parse("POST_AWARD:MONITORING:ACCEPTED"),
    ];

    it.each([
      ["a fully qualified position", "PRE_AWARD:REVIEW:RECEIVED"],
      ["a status code from another phase", "ACCEPTED"],
    ])("accepts a validFrom naming %s that exists", (_label, code) => {
      const status = statusOf({ validFrom: [{ code, processes: [] }] });

      expect(() => status.assertValidFromResolvesIn(positions)).not.toThrow();
    });

    it.each([
      ["a fully qualified position", "PRE_AWARD:OTHER:RECEIVED"],
      ["a status code", "MISSING"],
    ])("rejects a validFrom naming %s that does not exist", (_label, code) => {
      const status = statusOf({ validFrom: [{ code, processes: [] }] });

      expect(() => status.assertValidFromResolvesIn(positions)).toThrow(
        `status "PRE_AWARD:REVIEW:HELD" is valid from "${code}" which does not match any position in "phases"`,
      );
    });
  });
});
