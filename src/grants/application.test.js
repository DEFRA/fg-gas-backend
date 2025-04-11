import { describe, it, expect } from "vitest";
import Boom from "@hapi/boom";
import { createApplication } from "./application.js";

describe("createApplication", () => {
  it("creates an application with provided data", () => {
    const grantCode = "grant-1";

    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        answer1: {
          type: "string",
        },
        answer2: {
          type: "number",
        },
      },
    };

    const data = {
      metadata: {
        clientRef: "application-1",
        submittedAt: new Date("2021-01-01T00:00:00.000Z"),
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        answer1: "test",
      },
    };

    const application = createApplication(grantCode, schema, data);

    expect(application).toEqual({
      createdAt: expect.any(Date),
      grantCode,
      clientRef: data.metadata.clientRef,
      submittedAt: data.metadata.submittedAt,
      identifiers: {
        sbi: data.metadata.sbi,
        frn: data.metadata.frn,
        crn: data.metadata.crn,
        defraId: data.metadata.defraId,
      },
      answers: data.answers,
    });
  });

  it("drops answers not defined in the schema", () => {
    const grantCode = "grant-1";

    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        answer1: {
          type: "string",
        },
        answer2: {
          type: "number",
        },
      },
    };
    const data = {
      metadata: {
        clientRef: "application-1",
        submittedAt: new Date("2021-01-01T00:00:00.000Z"),
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        answer1: "test",
        answer2: 42,
        answer3: true, // Not defined in schema
      },
    };

    const application = createApplication(grantCode, schema, data);

    expect(application.answers).toEqual({
      answer1: "test",
      answer2: 42,
    });
  });

  it("uses default values provided in schema", () => {
    const grantCode = "grant-1";

    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        answer1: {
          type: "string",
          default: "default value",
        },
      },
      required: ["answer1"],
    };

    const data = {
      metadata: {
        clientRef: "application-1",
        submittedAt: new Date("2021-01-01T00:00:00.000Z"),
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {},
    };

    const application = createApplication(grantCode, schema, data);

    expect(application.answers).toEqual({
      answer1: "default value",
    });
  });

  it("throws when the answer is not of valid type", () => {
    const grantCode = "grant-1";

    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        answer1: {
          type: "string",
        },
        answer2: {
          type: "number",
        },
      },
      required: ["answer1", "answer2"],
    };

    const data = {
      metadata: {
        clientRef: "application-1",
        submittedAt: new Date("2021-01-01T00:00:00.000Z"),
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        answer1: 123, // Invalid type
        answer2: 42,
      },
    };

    expect(() => createApplication(grantCode, schema, data)).toThrow(
      Boom.badRequest(
        'Application with clientRef "application-1" has invalid answers: data/answer1 must be string',
      ),
    );
  });

  it("throws when required answers are missing", () => {
    const grantCode = "grant-1";

    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        answer1: {
          type: "string",
        },
        answer2: {
          type: "number",
        },
      },
      required: ["answer1", "answer2"],
    };

    const data = {
      metadata: {
        clientRef: "application-1",
        submittedAt: new Date("2021-01-01T00:00:00.000Z"),
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        answer1: "test", // Missing answer2
      },
    };

    expect(() => createApplication(grantCode, schema, data)).toThrow(
      Boom.badRequest(
        "Application with clientRef \"application-1\" has invalid answers: data must have required property 'answer2'",
      ),
    );
  });
});
