import { describe, expect, it } from "vitest";
import {
  documentProjectionOf,
  positionFieldsOf,
  unwindStagesOf,
} from "./document-projection.js";

const projected = (columns, documents = { whole: false, id: true }) =>
  documentProjectionOf({ columns, documents }, ["k"]);

const refusalOf = (build) => {
  try {
    build();
  } catch (error) {
    return error.refusal;
  }

  return null;
};

describe("documentProjectionOf", () => {
  it("projects nothing for a whole record, or only drops its _id", () => {
    expect(projected([], { whole: true, id: true })).toBeNull();
    expect(projected([], { whole: true, id: false })).toEqual({ "d._id": 0 });
  });

  it("writes each column as mongosh would send it, on the fetch's document", () => {
    expect(
      projected([
        { path: "_id" },
        { path: "clientRef" },
        { path: "phases.answers.parcels.0" },
        { path: "code", as: "grant" },
        { fn: "count", path: "phases.answers.parcels", as: "parcels" },
        { fn: "sum", path: "a.area", as: "area" },
        { fn: "min", path: "a.area", as: "least" },
        { fn: "max", path: "a.area", as: "most" },
        { path: "code", as: "names.grant" },
      ]),
    ).toEqual({
      k: 1,
      "d._id": 1,
      "d.clientRef": 1,
      "d.phases.answers.parcels.0": 1,
      "d.grant": "$d.code",
      "d.parcels": { $size: "$d.phases.answers.parcels" },
      "d.area": { $sum: "$d.a.area" },
      "d.least": { $min: "$d.a.area" },
      "d.most": { $max: "$d.a.area" },
      "d.names.grant": "$d.code",
    });
  });

  it("leaves _id out for _id: 0, however the columns name it", () => {
    expect(
      projected([{ path: "_id" }, { path: "code" }], {
        whole: false,
        id: false,
      }),
    ).toEqual({ k: 1, "d.code": 1 });
  });

  it("makes an empty document where _id: 0 leaves no column", () => {
    expect(
      projected([{ path: "_id" }], {
        whole: false,
        id: false,
      }),
    ).toEqual({ k: 1, d: { $literal: {} } });
  });

  it.each([
    ["a key starting $", [{ path: "phases.questions.$schema" }]],
    ["a malformed path", [{ path: "a..b" }]],
    ["a computed path holding $", [{ fn: "count", path: "a.$b", as: "n" }]],
    ["a name starting $", [{ path: "code", as: "$where" }]],
    ["a name with an empty part", [{ path: "code", as: "a..b" }]],
    ["a name with a part starting $", [{ path: "code", as: "a.$b" }]],
  ])("refuses %s", (_, columns) => {
    expect(refusalOf(() => projected(columns))).toBe("PATH_NOT_ALLOWED");
  });
});

describe("unwindStagesOf", () => {
  it("unwinds on the fetch's document, its index beside it, matched after each step", () => {
    const unwind = [
      { path: "a", preserve: false },
      { path: "a.b", preserve: true },
    ];

    expect(unwindStagesOf(unwind, (n) => ({ step: n }))).toEqual([
      {
        $unwind: {
          path: "$d.a",
          includeArrayIndex: "i0",
          preserveNullAndEmptyArrays: false,
        },
      },
      { $match: { step: 0 } },
      {
        $unwind: {
          path: "$d.a.b",
          includeArrayIndex: "i1",
          preserveNullAndEmptyArrays: true,
        },
      },
      { $match: { step: 1 } },
    ]);
    expect(positionFieldsOf(unwind)).toEqual(["$i0", "$i1"]);
  });

  it("refuses to unwind a path holding $", () => {
    expect(
      refusalOf(() =>
        unwindStagesOf([{ path: "a.$b", preserve: false }], () => ({})),
      ),
    ).toBe("PATH_NOT_ALLOWED");
  });
});
