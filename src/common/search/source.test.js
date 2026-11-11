import { afterEach, describe, expect, it, vi } from "vitest";
import { declarationOf } from "./declarations.js";
import {
  clearSearchSources,
  defineSearchSource,
  findSearchSource,
  registerSearchSource,
} from "./source.js";

const search = {
  fields: [{ key: "name", label: "Name", path: "$.answers.name" }],
};

const define = () =>
  defineSearchSource({
    collection: "record_search",
    records: "records",
    lead: "code",
    projection: { answers: 1 },
    viewOf: (record) => ({ answers: record.answers }),
    listDeclarations: vi.fn().mockResolvedValue([{ value: "grant-a", search }]),
  });

afterEach(() => {
  clearSearchSources();
});

describe("search sources", () => {
  it("finds a registered source by its collection, with its declarations", async () => {
    const source = define();
    registerSearchSource(source);

    expect(findSearchSource("record_search")).toBe(source);
    expect(await source.declarations.forValue("grant-a")).toEqual(
      declarationOf(search),
    );
  });

  it("refuses to register one collection twice", () => {
    registerSearchSource(define());

    expect(() => registerSearchSource(define())).toThrow(
      'Search "record_search" is already registered',
    );
  });

  it("throws for a collection nobody registered", () => {
    expect(() => findSearchSource("nothing")).toThrow(
      'Search "nothing" is not registered',
    );
  });
});
