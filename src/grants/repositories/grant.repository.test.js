import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { GrantDocument } from "../models/grant-document.js";
import { Grant } from "../models/grant.js";
import {
  findAll,
  findByCode,
  replace,
  save,
  saveFromDefinition,
} from "./grant.repository.js";

vi.mock("../../common/mongo-client.js");

describe("save", () => {
  it("stores a Grant in the repository", async () => {
    const insertOne = vi.fn().mockResolvedValueOnce({
      insertedId: "1",
    });

    db.collection.mockReturnValue({
      insertOne,
    });

    await save(
      new Grant({
        code: "1",
        version: "0.0.0",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [
          {
            method: "GET",
            name: "test",
            url: "http://localhost",
          },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );

    expect(db.collection).toHaveBeenCalledWith("grants");

    expect(insertOne).toHaveBeenCalledWith(
      new GrantDocument({
        code: "1",
        version: "0.0.0",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [
          {
            method: "GET",
            name: "test",
            url: "http://localhost",
          },
        ],
        entitlementTemplates: [],
      }),
    );
  });

  it("throws Boom.conflict when a grant with same code already exists", async () => {
    const error = new MongoServerError("E11000 duplicate key error collection");
    error.code = 11000;

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    await expect(
      save(
        new Grant({
          code: "1",
          version: "0.0.0",
          metadata: {
            description: "test",
            startDate: "2021-01-01T00:00:00.000Z",
          },
          actions: [
            {
              method: "GET",
              name: "test",
              url: "http://localhost",
            },
          ],
          questions: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
          },
        }),
      ),
    ).rejects.toThrow(
      Boom.conflict('Grant with code "1" version "0.0.0" already exists'),
    );
  });

  it("throws when an error occurs", async () => {
    const error = new Error("test");

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    await expect(
      save(
        new Grant({
          code: "1",
          version: "0.0.0",
          metadata: {
            description: "test",
            startDate: "2021-01-01T00:00:00.000Z",
          },
          actions: [
            {
              method: "GET",
              name: "test",
              url: "http://localhost",
            },
          ],
          questions: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
          },
        }),
      ),
    ).rejects.toThrow(error);
  });
});

describe("replace", () => {
  it("replaces a Grant in the repository", async () => {
    const replaceOne = vi.fn().mockResolvedValueOnce({
      insertedId: "code-1",
    });

    db.collection.mockReturnValue({
      replaceOne,
    });

    await replace(
      new Grant({
        code: "code-1",
        version: "0.0.0",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [
          {
            method: "GET",
            name: "test-action",
            url: "http://localhost",
          },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );

    expect(db.collection).toHaveBeenCalledWith("grants");

    expect(replaceOne).toHaveBeenCalledWith(
      { code: "code-1", version: "0.0.0" },
      new GrantDocument({
        code: "code-1",
        version: "0.0.0",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [
          {
            method: "GET",
            name: "test-action",
            url: "http://localhost",
          },
        ],
        entitlementTemplates: [],
      }),
    );
  });
});

describe("findAll", () => {
  it("returns all Grants from the repository", async () => {
    db.collection.mockReturnValueOnce({
      find: () => ({
        toArray: vi.fn().mockResolvedValueOnce([
          {
            code: "1",
            version: "0.0.0",
            metadata: {
              description: "test 1",
              startDate: "2021-01-01T00:00:00.000Z",
            },
            actions: [
              {
                method: "GET",
                name: "test",
                url: "http://localhost",
              },
            ],
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
            },
          },
          {
            code: "2",
            version: "0.0.0",
            metadata: {
              description: "test 2",
              startDate: "2021-01-02T00:00:00.000Z",
            },
            actions: [
              {
                method: "GET",
                name: "test",
                url: "http://localhost",
              },
            ],
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
            },
          },
        ]),
      }),
    });

    const result = await findAll();

    expect(db.collection).toHaveBeenCalledWith("grants");

    expect(result).toStrictEqual([
      new Grant({
        code: "1",
        version: "0.0.0",
        metadata: {
          description: "test 1",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [
          {
            method: "GET",
            name: "test",
            url: "http://localhost",
          },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
      new Grant({
        code: "2",
        version: "0.0.0",
        metadata: {
          description: "test 2",
          startDate: "2021-01-02T00:00:00.000Z",
        },
        actions: [
          {
            method: "GET",
            name: "test",
            url: "http://localhost",
          },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    ]);
  });
});

describe("findByCode", () => {
  it("defaults to version 0.0.0 and returns the legacy grant", async () => {
    const findOne = vi.fn().mockResolvedValueOnce({
      code: "adding-value",
      version: "0.0.0",
      metadata: {
        description: "test",
        startDate: "2021-01-01T00:00:00.000Z",
      },
      actions: [
        {
          method: "GET",
          name: "test",
          url: "http://localhost",
        },
      ],
    });

    db.collection.mockReturnValue({
      findOne,
    });

    const result = await findByCode("adding-value");

    expect(db.collection).toHaveBeenCalledWith("grants");

    expect(findOne).toHaveBeenCalledWith({
      code: "adding-value",
      version: "0.0.0",
    });

    expect(result).toStrictEqual(
      new Grant({
        code: "adding-value",
        version: "0.0.0",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [
          {
            method: "GET",
            name: "test",
            url: "http://localhost",
          },
        ],
      }),
    );
  });

  it("returns a grant for an explicit version", async () => {
    const findOne = vi.fn().mockResolvedValueOnce({
      code: "adding-value",
      version: "1.0.0",
      metadata: {
        description: "test v1",
        startDate: "2021-01-01T00:00:00.000Z",
      },
      actions: [],
    });

    db.collection.mockReturnValue({
      findOne,
    });

    const result = await findByCode("adding-value", "1.0.0");

    expect(findOne).toHaveBeenCalledWith({
      code: "adding-value",
      version: "1.0.0",
    });

    expect(result).toStrictEqual(
      new Grant({
        code: "adding-value",
        version: "1.0.0",
        metadata: {
          description: "test v1",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [],
      }),
    );
  });

  it("returns null when no match found for a given version", async () => {
    db.collection.mockReturnValue({
      findOne: vi.fn().mockResolvedValueOnce(null),
    });

    const result = await findByCode("woodland", "9.9.9");
    expect(result).toBeNull();
  });
});

describe("entitlementTemplates", () => {
  const phases = [
    {
      code: "PHASE_PRE_AWARD",
      stages: [
        {
          code: "STAGE_PREPARE_CLAIM",
          statuses: [{ code: "STATUS_PREPARING_CLAIM", validFrom: [] }],
        },
      ],
    },
    {
      code: "PHASE_CLAIM",
      stages: [
        {
          code: "STAGE_AWAITING_CLAIM",
          statuses: [{ code: "STATUS_AWAITING_CLAIM", validFrom: [] }],
        },
        {
          code: "STAGE_CLAIM_COMPLETE",
          statuses: [{ code: "STATUS_CLAIM_COMPLETE", validFrom: [] }],
        },
      ],
    },
  ];

  // The WMP template exactly as the grant definition writes it, so the
  // round-trip tests below prove the documented shape survives Mongo unchanged
  // - nulls, nested fields map and all.
  const entitlementTemplates = [
    {
      claimCode: "ENT_CS_CAPITAL_PA3",
      name: "PA3 Woodland Management Plan entitlement",
      description:
        "The maximum eligible woodland area that can be claimed under PA3.",
      materialised: false,
      fields: {
        totalHectares: {
          input: true,
          label: "Total area of eligible woodland",
          unitType: "decimal",
          decimalPlaces: 4,
          unit: "HA",
          minValue: 0.5,
          maxValue: null,
        },
        actionCode: {
          input: false,
          value: "PA3",
          unitType: "string",
          minLength: 1,
          maxLength: null,
        },
        actionVersion: {
          input: false,
          value: "jsonata: $.agreement.actions[code='PA3'].version",
          unitType: "string",
          minLength: 1,
          maxLength: null,
        },
      },
      maxEntitlements: 1,
      availableAt: {
        phase: "PHASE_PRE_AWARD",
        stage: "STAGE_PREPARE_CLAIM",
        status: "STATUS_PREPARING_CLAIM",
      },
      claim: {
        limits: { maximumClaims: 1, allowsPartialClaims: false },
        requiresApproval: false,
        requiresEvidence: false,
      },
    },
  ];

  it("persists entitlementTemplates on the stored document when saving a grant", async () => {
    const insertOne = vi.fn().mockResolvedValueOnce({ insertedId: "1" });

    db.collection.mockReturnValue({ insertOne });

    await save(
      new Grant({
        code: "woodland",
        version: "0.0.0",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [],
        phases,
        entitlementTemplates,
      }),
    );

    expect(insertOne).toHaveBeenCalledWith(
      new GrantDocument({
        code: "woodland",
        version: "0.0.0",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [],
        phases,
        entitlementTemplates,
      }),
    );
  });

  it("rehydrates entitlementTemplates from a stored document via findByCode", async () => {
    const findOne = vi.fn().mockResolvedValueOnce({
      code: "woodland",
      version: "0.0.0",
      metadata: {
        description: "test",
        startDate: "2021-01-01T00:00:00.000Z",
      },
      actions: [],
      phases,
      entitlementTemplates,
    });

    db.collection.mockReturnValue({ findOne });

    const result = await findByCode("woodland");

    expect(result.entitlementTemplates).toEqual(entitlementTemplates);
  });

  it("round-trips entitlementTemplates from a grant definition via saveFromDefinition", async () => {
    const insertOne = vi.fn().mockResolvedValueOnce({ insertedId: "1" });

    db.collection.mockReturnValue({ insertOne });

    const grantDefinition = {
      code: "woodland",
      metadata: {
        description: "test",
        startDate: "2021-01-01T00:00:00.000Z",
      },
      actions: [],
      phases,
      entitlementTemplates,
    };

    const grant = await saveFromDefinition(grantDefinition, "1.0.0");

    expect(grant.entitlementTemplates).toEqual(entitlementTemplates);
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ entitlementTemplates }),
    );
  });

  // Grants written before entitlement templates existed have no such key, and
  // one written without any comes back as null. Both are normalised here rather
  // than in the model, which takes a collection and nothing else.
  it.each([
    ["the key is absent", {}],
    ["the key is null", { entitlementTemplates: null }],
  ])(
    "reads entitlementTemplates as an empty collection when %s",
    async (_label, storedField) => {
      const findOne = vi.fn().mockResolvedValueOnce({
        code: "legacy",
        version: "1.0.0",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [],
        phases,
        ...storedField,
      });

      db.collection.mockReturnValue({ findOne });

      const result = await findByCode("legacy");

      expect(result.entitlementTemplates).toEqual([]);
      expect(result.findEntitlementTemplate("ANYTHING")).toBeUndefined();
      expect(
        result.findEntitlementTemplatesAvailableAt({
          phase: "PHASE_PRE_AWARD",
          stage: "STAGE_PREPARE_CLAIM",
          status: "STATUS_PREPARING_CLAIM",
        }),
      ).toEqual([]);
    },
  );

  // The driver resolves ignoreUndefined to false, so the optional keys a
  // materialised template omits are stored as null - which is what findByCode
  // then feeds back into the model. Without this, the commonest template of all
  // saves cleanly and 500s on every subsequent read.
  it("rehydrates a materialised template stored with nulls for its omitted keys", async () => {
    const findOne = vi.fn().mockResolvedValueOnce({
      code: "woodland",
      version: "1.0.0",
      metadata: { description: "test", startDate: "2021-01-01T00:00:00.000Z" },
      actions: [],
      phases,
      entitlementTemplates: [
        {
          claimCode: "ENT_TRACTOR",
          name: "Tractor entitlement",
          description: null,
          materialised: true,
          fields: null,
          maxEntitlements: 1,
          availableAt: {
            phase: "PHASE_PRE_AWARD",
            stage: "STAGE_PREPARE_CLAIM",
            status: "STATUS_PREPARING_CLAIM",
          },
          claim: null,
        },
      ],
    });

    db.collection.mockReturnValue({ findOne });

    const result = await findByCode("woodland");
    const template = result.findEntitlementTemplate("ENT_TRACTOR");

    expect(template.description).toBeUndefined();
    expect(template.fields).toBeUndefined();
    expect(template.claim).toBeUndefined();
  });
});

describe("pages", () => {
  const phases = [
    {
      code: "PRE_AWARD",
      stages: [
        {
          code: "ASSESSMENT",
          statuses: [{ code: "APPLICATION_RECEIVED", validFrom: [] }],
        },
      ],
    },
  ];

  const pages = {
    claims: {
      details: {
        banner: {
          title: {
            text: "$.answers.applicant.business.name",
            type: "string",
          },
          summary: {
            sbi: { label: "SBI", text: "$.identifiers.sbi", type: "string" },
          },
        },
      },
    },
  };

  const definition = {
    code: "woodland",
    metadata: { description: "test", startDate: "2021-01-01T00:00:00.000Z" },
    actions: [],
    phases,
    pages,
  };

  it("round-trips pages from a grant definition via saveFromDefinition", async () => {
    const insertOne = vi.fn().mockResolvedValueOnce({ insertedId: "1" });

    db.collection.mockReturnValue({ insertOne });

    const grant = await saveFromDefinition(definition, "1.1.0");

    expect(grant.pages).toEqual(pages);
    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ pages }));
  });

  it("rehydrates pages from a stored document via findByCode", async () => {
    const findOne = vi
      .fn()
      .mockResolvedValueOnce({ ...definition, version: "0.0.0" });

    db.collection.mockReturnValue({ findOne });

    const result = await findByCode("woodland");

    expect(result.pages).toEqual(pages);
  });

  // The driver resolves ignoreUndefined to false, so a grant saved without
  // pages reads back as null - which the model only takes as "absent" when it
  // arrives undefined.
  it("reads a stored null as no pages at all", async () => {
    const findOne = vi.fn().mockResolvedValueOnce({
      ...definition,
      version: "0.0.0",
      pages: null,
    });

    db.collection.mockReturnValue({ findOne });

    const result = await findByCode("woodland");

    expect(result.pages).toBeUndefined();
  });
});
