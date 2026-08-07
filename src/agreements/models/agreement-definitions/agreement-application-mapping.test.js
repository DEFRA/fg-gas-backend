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
  },
  states: { offered: { page: "offered" } },
  pages: {
    offered: {
      title: "Offer",
      components: [{ component: "heading", text: "Offer" }],
    },
  },
});

const constructDefinition = (application) =>
  new AgreementDefinition(createDefinition(application));

describe("AgreementDefinition Application mapping", () => {
  it("selects a source-shaped Application from the complete Creation Input", async () => {
    const definition = new AgreementDefinition(
      createDefinition("$.input.answers"),
    );

    await expect(
      definition.resolveApplication({
        answers: { applicant: "Test Farmer", quantity: 4 },
        delivery: { source: "ignored" },
      }),
    ).resolves.toEqual({ applicant: "Test Farmer", quantity: 4 });
  });

  it("can select a differently named source subtree", async () => {
    const definition = new AgreementDefinition(
      createDefinition("$.input.payload"),
    );

    await expect(
      definition.resolveApplication({ payload: { parcelCount: 2 } }),
    ).resolves.toEqual({ parcelCount: 2 });
  });

  it("assembles Application while preserving nested value types", async () => {
    const definition = new AgreementDefinition(
      createDefinition({
        applicant: "$.input.registration.applicant",
        eligible: "jsonata:$.input.answers.quantity > 0",
        facts: [
          "$.input.answers.quantity",
          { registered: "$.input.registration.registered" },
        ],
        quantities: "$.input.answers.quantities",
        source: { clientRef: "$.input.clientRef" },
      }),
    );

    await expect(
      definition.resolveApplication({
        answers: { quantity: 3, quantities: [1, 2, 3] },
        clientRef: "client-123",
        registration: { applicant: "Test Farmer", registered: true },
      }),
    ).resolves.toEqual({
      applicant: "Test Farmer",
      eligible: true,
      facts: [3, { registered: true }],
      quantities: [1, 2, 3],
      source: { clientRef: "client-123" },
    });
  });

  it("isolates configured mapping state", async () => {
    const configuration = createDefinition({
      source: { label: "Configured label" },
    });
    const definition = new AgreementDefinition(configuration);

    configuration.create.application.source.label = "Changed label";
    const application = await definition.resolveApplication({});
    application.source.label = "Changed result";

    await expect(definition.resolveApplication({})).resolves.toEqual({
      source: { label: "Configured label" },
    });
  });

  it("isolates the Creation Input and every resolved Application", async () => {
    const input = { source: { applicant: "Test Farmer" } };
    const definition = new AgreementDefinition(
      createDefinition("$.input.source"),
    );

    const firstApplication = await definition.resolveApplication(input);
    firstApplication.applicant = "Changed";
    const secondApplication = await definition.resolveApplication(input);

    expect(input).toEqual({ source: { applicant: "Test Farmer" } });
    expect(secondApplication).toEqual({ applicant: "Test Farmer" });
    expect(secondApplication).not.toBe(firstApplication);
  });

  it("rejects a resolved value that is not a source-shaped object", async () => {
    const definition = new AgreementDefinition(
      createDefinition("$.input.application"),
    );

    await expect(
      definition.resolveApplication({ application: "Sensitive value" }),
    ).rejects.toMatchObject({
      message:
        'Agreement definition "test-application" resolved an invalid Application',
      output: { statusCode: 500 },
    });
  });

  it("redacts unresolved Application mappings", async () => {
    const definition = new AgreementDefinition(
      createDefinition("$.input.missing"),
    );

    try {
      await definition.resolveApplication({
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
