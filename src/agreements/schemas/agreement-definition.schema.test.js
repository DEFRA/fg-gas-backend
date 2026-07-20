import { describe, expect, it } from "vitest";
import { pmfAgreementDefinition } from "../models/agreement-definitions/pmf.js";
import { agreementDefinitionSchema } from "./agreement-definition.schema.js";

const validate = (definition) =>
  agreementDefinitionSchema.validate(definition, { abortEarly: false });

const getAcceptSnapshotEffect = (definition) =>
  definition.states.offered.on.accept.effects.find(
    (effect) => effect.name === "snapshot",
  );

describe("agreementDefinitionSchema", () => {
  it("validates a complete agreement definition", () => {
    const { error } = validate(pmfAgreementDefinition);

    expect(error).toBeUndefined();
  });

  it("fails when top-level required fields are missing", () => {
    const { error } = validate({});

    expect(error).toBeDefined();
    const messages = error.details.map((d) => d.message).join(", ");
    expect(messages).toMatch(/"code" is required/);
    expect(messages).toMatch(/"configVersion" is required/);
    expect(messages).toMatch(/"agreementNumberPrefix" is required/);
    expect(messages).toMatch(/"Create" is required/);
    expect(messages).toMatch(/"States" is required/);
    expect(messages).toMatch(/"Pages" is required/);
  });

  it("fails when create.target is missing", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    delete definition.create.target;

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /"create.target" is required/,
    );
  });

  it("fails when a lifecycle action is missing its target", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    delete definition.states.offered.on.accept.target;

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /"states.offered.on.accept.target" is required/,
    );
  });

  it("fails when validation.required is empty", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.states.offered.on.accept.validation.required = [];

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /must contain at least 1 items/,
    );
  });

  it("fails when an effect is missing its name", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    delete definition.create.effects[0].name;

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /"create.effects\[0\].name" is required/,
    );
  });

  it("fails when a page is missing its title", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    delete definition.pages.offered.title;

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /"pages.offered.title" is required/,
    );
  });

  it("fails when a page component is missing its component name", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    delete definition.pages.offered.components[0].component;

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /"pages.offered.components\[0\].component" is required/,
    );
  });

  it("fails when states has no entries", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.states = {};

    const { error } = validate(definition);

    expect(error).toBeDefined();
  });

  it("fails when an effect names a handler the effect runner doesn't support", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.create.effects[0].name = "notARealHandler";

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /"create.effects\[0\].name" must be one of/,
    );
  });

  it("allows the same effects for Agreement creation and actions", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.states.offered.on.accept.effects = [
      structuredClone(definition.create.effects[0]),
    ];

    const { error } = validate(definition);

    expect(error).toBeUndefined();
  });

  it("rejects the obsolete snapshot destination property", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    getAcceptSnapshotEffect(definition).destination = "item";

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /effects\[\d+\]\.destination.*is not allowed/,
    );
  });

  it.each(["state", "agreementItemId", "schemeSpecificResult"])(
    "rejects the unsupported top-level snapshot parameter %s",
    (field) => {
      const definition = structuredClone(pmfAgreementDefinition);
      getAcceptSnapshotEffect(definition).params[field] = "$.outputs.value";

      const { error } = validate(definition);

      expect(error).toBeDefined();
      expect(error.details.map((detail) => detail.message).join(", ")).toMatch(
        new RegExp(`params\\.${field}.*not allowed`),
      );
    },
  );

  it("allows known payment fields in an item snapshot", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    getAcceptSnapshotEffect(definition).params = {
      acceptedAt: "$.executedAt",
      claimId: "$.outputs.paymentClaim.claimId",
      correlationId: "$.outputs.paymentClaim.correlationId",
      originalInvoiceNumber: "$.outputs.paymentClaim.originalInvoiceNumber",
      payment: "$.outputs.paymentClaim.payment",
    };

    const { error } = validate(definition);

    expect(error).toBeUndefined();
  });

  it("allows arbitrary snapshot fields beneath supplementaryData", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    getAcceptSnapshotEffect(definition).params.supplementaryData = {
      schemeSpecificResult: "$.outputs.value",
    };

    const { error } = validate(definition);

    expect(error).toBeUndefined();
  });

  it("allows supplementaryData to be supplied by a resolved object reference", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    getAcceptSnapshotEffect(definition).params.supplementaryData =
      "$.outputs.schemeData";

    const { error } = validate(definition);

    expect(error).toBeUndefined();
  });

  it("allows extra keys on validation and action transitions, so other agreement types can extend them", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.states.offered.on.accept.validation.hint = "extra guidance";
    definition.states.offered.on.accept.description = "Accept the offer";

    const { error } = validate(definition);

    expect(error).toBeUndefined();
  });

  it("allows extra keys on effect, required-validation-field, page action and page, so other agreement types can extend them", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    definition.create.effects[1].condition = "always";
    definition.states.offered.on.accept.validation.required[0].hint =
      "extra guidance";
    definition.pages.offered.actions[0].style = "secondary";
    definition.pages.offered.extraPageMetadata = "allowed";

    const { error } = validate(definition);

    expect(error).toBeUndefined();
  });

  it("fails when an endpoint is missing a required field", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    delete definition.endpoints[0].service;

    const { error } = validate(definition);

    expect(error).toBeDefined();
    expect(error.details.map((d) => d.message).join(", ")).toMatch(
      /"endpoints\[0\].service" is required/,
    );
  });

  it("validates without an endpoints array, since it's optional", () => {
    const definition = structuredClone(pmfAgreementDefinition);
    delete definition.endpoints;

    const { error } = validate(definition);

    expect(error).toBeUndefined();
  });
});
