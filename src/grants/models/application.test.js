import { describe, it, expect } from "vitest";
import Boom from "@hapi/boom";
import { createApplication } from "./application.js";

describe("createApplication", () => {
  it("creates an application with provided data", () => {
    const code = "grant-1";

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

    const application = createApplication(code, schema, data);

    expect(application).toEqual({
      createdAt: expect.any(Date),
      code,
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

  it("creates an application when data with various formats", () => {
    const code = "grant-1";

    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        answer1: {
          type: "string",
          format: "date-time",
        },
        answer2: {
          type: "string",
          format: "date",
        },
        answer3: {
          type: "string",
          format: "time",
        },
        answer4: {
          type: "string",
          format: "duration",
        },
        answer5: {
          type: "string",
          format: "email",
        },
        answer6: {
          type: "string",
          format: "uri",
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
        answer1: "2024-08-10T12:00:00.000Z",
        answer2: "2024-08-10",
        answer3: "12:00:00.000Z",
        answer4: "P1Y2M10DT2H30M",
        answer5: "mark@itaccomplice.co.uk",
        answer6: "https://www.itaccomplice.co.uk",
      },
    };

    const application = createApplication(code, schema, data);

    expect(application).toEqual({
      createdAt: expect.any(Date),
      code,
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
    const code = "grant-1";

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

    const application = createApplication(code, schema, data);

    expect(application.answers).toEqual({
      answer1: "test",
      answer2: 42,
    });
  });

  it("uses default values provided in schema", () => {
    const code = "grant-1";

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

    const application = createApplication(code, schema, data);

    expect(application.answers).toEqual({
      answer1: "default value",
    });
  });

  it("throws when the answer is not of valid type", () => {
    const code = "grant-1";

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

    expect(() => createApplication(code, schema, data)).toThrow(
      Boom.badRequest(
        'Application with clientRef "application-1" has invalid answers: data/answer1 must be string',
      ),
    );
  });

  it("throws when required answers are missing", () => {
    const code = "grant-1";

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

    expect(() => createApplication(code, schema, data)).toThrow(
      Boom.badRequest(
        "Application with clientRef \"application-1\" has invalid answers: data must have required property 'answer2'",
      ),
    );
  });

  it("throws when invalid format", () => {
    const code = "grant-1";

    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        answer1: {
          type: "string",
          format: "date-time",
        },
        answer2: {
          type: "string",
          format: "date",
        },
        answer3: {
          type: "string",
          format: "time",
        },
        answer4: {
          type: "string",
          format: "duration",
        },
        answer5: {
          type: "string",
          format: "email",
        },
        answer6: {
          type: "string",
          format: "uri",
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
        answer1: "2024-08-10",
        answer2: "2024-08-10T12:00:00.000Z",
        answer3: "12:00",
        answer4: "PY2M10DT2H30M",
        answer5: "mark.itaccomplice.co.uk",
        answer6: "www.itaccomplice.co.uk",
      },
    };

    expect(() => createApplication(code, schema, data)).toThrow(
      Boom.badRequest(
        'Application with clientRef "application-1" has invalid answers: data/answer1 must match format "date-time", data/answer2 must match format "date", data/answer3 must match format "time", data/answer4 must match format "duration", data/answer5 must match format "email", data/answer6 must match format "uri"',
      ),
    );
  });

  it("throws when invalid format specified", () => {
    const code = "grant-1";

    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        answer1: {
          type: "string",
          format: "hostname",
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
      answers: {
        answer1: "A.ISI.EDU",
      },
    };

    expect(() => createApplication(code, schema, data)).toThrow(
      Boom.badRequest(
        'Error occurred when validating application with clientRef "application-1". Error: unknown format "hostname" ignored in schema at path "#/properties/answer1"',
      ),
    );
  });
});
