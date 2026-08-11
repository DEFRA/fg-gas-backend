import { describe, expect, it } from "vitest";
import { AgreementDefinition } from "./agreement-definition.js";

const createDefinition = (application) => ({
  code: "test-application",
  configVersion: "1.0.0",
  agreementNumberPrefix: "TST",
  create: {
    target: "offered",
    processes: [],
    application,
    values: { actions: [], items: [] },
  },
  states: { offered: { page: "offered" } },
  pages: {
    offered: {
      title: "Offer",
      components: [{ component: "heading", text: "Offer" }],
    },
  },
});

const execution = {
  correlationId: "creation-correlation-id",
  executedAt: "2026-08-06T12:00:00.000Z",
};

const constructDefinition = (application) =>
  new AgreementDefinition(createDefinition(application), {
    generateAgreementNumber: () => "TST123456789",
  });

const createAgreement = (definition, input = {}) =>
  definition.createAgreement({
    input: {
      code: "test-application",
      clientRef: "test-client-ref",
      identifiers: { sbi: "300000069" },
      ...input,
    },
    execution,
  });

describe("AgreementDefinition Application mapping", () => {
  it("selects a source-shaped Application from the complete Creation Input", async () => {
    const definition = constructDefinition("$.input.answers");

    await expect(
      createAgreement(definition, {
        answers: { applicant: "Test Farmer", quantity: 4 },
        delivery: { source: "ignored" },
      }),
    ).resolves.toMatchObject({
      application: { applicant: "Test Farmer", quantity: 4 },
    });
  });

  it("can select a differently named source subtree", async () => {
    const definition = constructDefinition("$.input.payload");

    await expect(
      createAgreement(definition, { payload: { parcelCount: 2 } }),
    ).resolves.toMatchObject({ application: { parcelCount: 2 } });
  });

  it("assembles Application while preserving nested value types", async () => {
    const definition = constructDefinition({
      applicant: "$.input.registration.applicant",
      eligible: "jsonata:$.input.answers.quantity > 0",
      facts: [
        "$.input.answers.quantity",
        { registered: "$.input.registration.registered" },
      ],
      quantities: "$.input.answers.quantities",
      source: { clientRef: "$.input.clientRef" },
    });

    await expect(
      createAgreement(definition, {
        answers: { quantity: 3, quantities: [1, 2, 3] },
        clientRef: "client-123",
        registration: { applicant: "Test Farmer", registered: true },
      }),
    ).resolves.toMatchObject({
      application: {
        applicant: "Test Farmer",
        eligible: true,
        facts: [3, { registered: true }],
        quantities: [1, 2, 3],
        source: { clientRef: "client-123" },
      },
    });
  });

  it("isolates configured mapping state", async () => {
    const configuration = createDefinition({
      source: { label: "Configured label" },
    });
    const definition = new AgreementDefinition(configuration, {
      generateAgreementNumber: () => "TST123456789",
    });

    configuration.create.application.source.label = "Changed label";
    const firstAgreement = await createAgreement(definition);
    firstAgreement.application.source.label = "Changed result";

    await expect(createAgreement(definition)).resolves.toMatchObject({
      application: { source: { label: "Configured label" } },
    });
  });

  it("isolates the Creation Input and every resolved Application", async () => {
    const input = { source: { applicant: "Test Farmer" } };
    const definition = constructDefinition("$.input.source");

    const firstAgreement = await createAgreement(definition, input);
    firstAgreement.application.applicant = "Changed";
    const secondAgreement = await createAgreement(definition, input);

    expect(input).toEqual({ source: { applicant: "Test Farmer" } });
    expect(secondAgreement.application).toEqual({ applicant: "Test Farmer" });
    expect(secondAgreement.application).not.toBe(firstAgreement.application);
  });

  it("rejects a resolved value that is not a source-shaped object", async () => {
    const definition = constructDefinition("$.input.application");

    await expect(
      createAgreement(definition, { application: "Sensitive value" }),
    ).rejects.toMatchObject({
      message:
        'Agreement definition "test-application" resolved an invalid Application',
      output: { statusCode: 500 },
    });
  });

  it("redacts unresolved Application mappings", async () => {
    const definition = constructDefinition("$.input.missing");

    try {
      await createAgreement(definition, {
        customerName: "Sensitive Customer",
      });
      expect.unreachable("expected Application resolution to fail");
    } catch (error) {
      expect(error.output.statusCode).toBe(500);
      expect(error.message).toBe(
        'Agreement definition "test-application" could not resolve Application',
      );
      expect(error.message).not.toContain("Sensitive Customer");
      expect(error.message).not.toContain("$.input.missing");
    }
  });

  it("requires Process-based creation to configure Application mapping", () => {
    expect(() => constructDefinition(undefined)).toThrow(
      'Invalid agreement definition "test-application": "create.application" is required',
    );
  });

  it("rejects a non-serialisable mapping when the Definition is constructed", () => {
    expect(() =>
      constructDefinition({ value: () => "Sensitive configuration" }),
    ).toThrow(
      'Invalid agreement definition "test-application": "create.application" contains an invalid mapping',
    );
  });

  it("rejects invalid mapping syntax when the Definition is constructed", () => {
    try {
      constructDefinition("jsonata:secret-configuration-value + (");
      expect.unreachable("expected Definition construction to fail");
    } catch (error) {
      expect(error.output.statusCode).toBe(500);
      expect(error.message).toBe(
        'Invalid agreement definition "test-application": "create.application" contains an invalid mapping',
      );
      expect(error.message).not.toContain("secret-configuration-value");
    }
  });
});
