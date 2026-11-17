import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerGasExploreSources } from "../../../test/helpers/explore-sources.js";
import { findGrantQuestionSchemas } from "../../grants/services/config-version.service.js";
import {
  cwExploreFailure,
  findCwExploreSources,
} from "../repositories/cw-explore.repository.js";
import { exploreVocabularyUseCase } from "./explore-vocabulary.use-case.js";
import {
  FAILED_MS,
  VOCABULARY_MS,
  forgetExploreVocabulary,
  keptVocabulary,
  loadExploreVocabulary,
} from "./load-explore-vocabulary.js";

vi.mock("../../common/logger.js");
vi.mock("../../grants/services/config-version.service.js");
vi.mock("../repositories/cw-explore.repository.js", async (importOriginal) => ({
  ...(await importOriginal()),
  findCwExploreSources: vi.fn(),
}));

const CW = {
  versions: [2],
  sources: [
    {
      name: "cases",
      label: "Cases",
      service: "CW",
      size: "big",
      noun: { one: "case", many: "cases" },
      star: ["caseRef"],
      time: "createdAt",
      roots: ["caseRef", "payload"],
      answersAt: "payload.answers",
      listedAt: "payload.answers",
      requires: null,
      answerPaths: ["applicant.business.name", "referenceNumber"],
      paths: [
        {
          path: "caseRef",
          type: "text",
          index: "ref",
          closed: false,
          within: null,
        },
      ],
    },
  ],
};

const SCHEMA = {
  type: "object",
  properties: {
    referenceNumber: { type: "string" },
    sbi: { type: "string" },
    parcels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          area: { type: "number" },
          agreed: { type: "boolean" },
          planted: { type: "string", format: "date" },
        },
      },
    },
    bank: { type: "object", properties: { sortCode: { type: "string" } } },
  },
};

beforeEach(() => {
  registerGasExploreSources();
  forgetExploreVocabulary();
  findGrantQuestionSchemas.mockResolvedValue([SCHEMA]);
});

describe("loadExploreVocabulary", () => {
  it("suggests every answer path the stored schemas name, typed, under each source's answers", async () => {
    findCwExploreSources.mockResolvedValue(CW);

    const vocabulary = await loadExploreVocabulary();
    const applications = vocabulary.sources.get("applications");

    expect(applications.paths.get("phases.answers.referenceNumber")).toEqual({
      path: "phases.answers.referenceNumber",
      type: "text",
      index: null,
      closed: false,
      within: null,
    });
    expect(applications.paths.get("phases.answers.parcels.area").type).toBe(
      "number",
    );
    expect(applications.paths.get("phases.answers.parcels.agreed").type).toBe(
      "boolean",
    );
    expect(applications.paths.get("phases.answers.parcels.planted").type).toBe(
      "date",
    );
    expect(applications.paths.has("phases.answers.bank.sortCode")).toBe(false);
    expect(vocabulary.cwVersion).toBe(2);
  });

  it("keeps a good answer, and reads the definitions once in five minutes", async () => {
    findCwExploreSources.mockResolvedValue(CW);

    await loadExploreVocabulary();
    await loadExploreVocabulary();

    expect(findCwExploreSources).toHaveBeenCalledTimes(1);
    expect(findGrantQuestionSchemas).toHaveBeenCalledTimes(1);
  });

  it("never keeps a failure", async () => {
    findCwExploreSources.mockRejectedValueOnce(cwExploreFailure("TIMED_OUT"));
    findCwExploreSources.mockResolvedValueOnce(CW);

    const failed = await loadExploreVocabulary();

    expect(failed.unavailable.get("cases").output.payload.reason).toBe(
      "TIMED_OUT",
    );
    expect((await loadExploreVocabulary()).sources.has("cases")).toBe(true);
  });

  it("builds the vocabulary without answer suggestions when the definitions can't be read, and keeps no failure", async () => {
    findCwExploreSources.mockResolvedValue(CW);
    findGrantQuestionSchemas.mockRejectedValueOnce(new Error("no primary"));

    const failed = await loadExploreVocabulary();

    expect(failed.sources.get("applications").paths.size).toBeGreaterThan(0);
    expect(
      [...failed.sources.get("applications").paths.keys()].some((path) =>
        path.startsWith("phases.answers."),
      ),
    ).toBe(false);
    expect(
      (await loadExploreVocabulary()).sources
        .get("applications")
        .paths.has("phases.answers.referenceNumber"),
    ).toBe(true);
  });

  it("asks Caseworking nothing for a query that reads none of its sources", async () => {
    const vocabulary = await loadExploreVocabulary({ withCw: false });

    expect(findCwExploreSources).not.toHaveBeenCalled();
    expect(vocabulary.sources.has("applications")).toBe(true);
    expect(vocabulary.cwVersion).toBeNull();
  });

  it("shares a read already in flight", async () => {
    findCwExploreSources.mockResolvedValue(CW);

    await Promise.all([loadExploreVocabulary(), loadExploreVocabulary()]);

    expect(findCwExploreSources).toHaveBeenCalledTimes(1);
    expect(findGrantQuestionSchemas).toHaveBeenCalledTimes(1);
  });

  describe("with the time a request has left", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("answers without suggestions, and Caseworking as out of time, when the reads outlast it", async () => {
      findCwExploreSources.mockReturnValue(new Promise(() => {}));
      findGrantQuestionSchemas.mockReturnValue(new Promise(() => {}));

      const loading = loadExploreVocabulary({ timeLeftMs: 1_000 });
      await vi.advanceTimersByTimeAsync(1_000);
      const vocabulary = await loading;

      expect(vocabulary.unavailable.get("cases").output.payload.reason).toBe(
        "TIMED_OUT",
      );
      expect(
        vocabulary.sources
          .get("applications")
          .paths.has("phases.answers.referenceNumber"),
      ).toBe(false);
    });
  });

  it("says Caseworking doesn't offer queries when it reads no version GAS sends, v1 too", async () => {
    findCwExploreSources.mockResolvedValue({ ...CW, versions: [1] });

    const vocabulary = await loadExploreVocabulary();

    expect(vocabulary.unavailable.get("cases").output.payload.reason).toBe(
      "NOT_OFFERED",
    );
  });
});

describe("exploreVocabularyUseCase", () => {
  it("answers the editor's vocabulary", async () => {
    findCwExploreSources.mockResolvedValue(CW);

    const vocabulary = await exploreVocabularyUseCase({});

    expect(vocabulary.sources.map(({ name }) => name)).toEqual([
      "applications",
      "cases",
      "grants",
      "events",
      "agreements",
      "payments",
    ]);
    expect(vocabulary.sources[1]).toEqual({
      name: "cases",
      label: "Cases",
      time: "createdAt",
      paths: [
        { path: "caseRef", type: "text", indexed: true },
        {
          path: "payload.answers.referenceNumber",
          type: "text",
          indexed: false,
        },
        { path: "payload.answers.applicant.business.name", indexed: false },
      ],
    });
  });
});

describe("keptVocabulary", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const built = (name) => ({ vocabulary: { name }, failed: false });

  it("builds once for requests that arrive while it is built, per set of roles", async () => {
    const build = vi.fn(async () => built("devops"));
    const other = vi.fn(async () => built("finance"));

    const answers = await Promise.all([
      keptVocabulary("devops", build),
      keptVocabulary("devops", build),
      keptVocabulary("finance", other),
    ]);

    expect(answers).toEqual([
      { name: "devops" },
      { name: "devops" },
      { name: "finance" },
    ]);
    expect(build).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("answers a kept one for a minute, then at once while it is built again behind it", async () => {
    vi.useFakeTimers();
    const build = vi
      .fn()
      .mockResolvedValueOnce(built("first"))
      .mockResolvedValueOnce(built("second"));

    await keptVocabulary("devops", build);
    vi.advanceTimersByTime(VOCABULARY_MS - 1);

    expect(await keptVocabulary("devops", build)).toEqual({ name: "first" });
    expect(build).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);

    expect(await keptVocabulary("devops", build)).toEqual({ name: "first" });
    expect(build).toHaveBeenCalledTimes(2);
    await vi.waitFor(async () =>
      expect(await keptVocabulary("devops", build)).toEqual({
        name: "second",
      }),
    );
  });

  it("keeps nothing from a build that fails, and builds again on the next request", async () => {
    const build = vi
      .fn()
      .mockRejectedValueOnce(new Error("unread"))
      .mockResolvedValueOnce(built("devops"));

    await expect(keptVocabulary("devops", build)).rejects.toThrow("unread");
    expect(await keptVocabulary("devops", build)).toEqual({ name: "devops" });
  });

  it("keeps a bounded number of role sets, forgetting the oldest", async () => {
    const build = vi.fn(async () => built("any"));

    for (let n = 0; n <= 50; n++) {
      await keptVocabulary(`roles-${n}`, build);
    }
    await keptVocabulary("roles-0", build);
    await keptVocabulary("roles-50", build);

    expect(build).toHaveBeenCalledTimes(52);
  });
});

describe("exploreVocabularyUseCase kept per set of roles", () => {
  it("draws one vocabulary for the same roles however they are listed, and another for others", async () => {
    findCwExploreSources.mockResolvedValue(CW);
    const ask = (roles) => exploreVocabularyUseCase({ roles });

    const first = await ask("devops, finance");

    expect(await ask("finance,devops,devops")).toBe(first);
    expect(await ask("devops")).not.toBe(first);
  });

  it("keeps a vocabulary missing Caseworking only a short while", async () => {
    vi.useFakeTimers();
    findCwExploreSources.mockRejectedValue(cwExploreFailure("TIMED_OUT"));
    const ask = () => exploreVocabularyUseCase({});

    const first = await ask();
    vi.advanceTimersByTime(FAILED_MS);
    findCwExploreSources.mockResolvedValue(CW);
    await ask();
    await vi.waitFor(async () =>
      expect((await ask()).sources.map(({ name }) => name)).toContain("cases"),
    );

    expect(first.sources.map(({ name }) => name)).not.toContain("cases");
    vi.useRealTimers();
  });
});
