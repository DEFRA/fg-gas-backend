import { describe, expect, it } from "vitest";
import { agreementPageModelResponseSchema } from "./agreement-page-model-response.schema.js";

const pageModel = {
  agreement: {
    agreementNumber: "TST123",
    code: "test",
    clientRef: "client",
    identifiers: { sbi: "900000012" },
    state: "offered",
    version: 1,
  },
  page: { name: "offer", title: "Offer" },
  components: [],
};

const validate = (value) => agreementPageModelResponseSchema.validate(value);

describe("agreementPageModelResponseSchema", () => {
  it("keeps the service title", () => {
    const { error, value } = validate({
      ...pageModel,
      serviceTitle: "Woodland Management Plan",
    });

    expect(error).toBeUndefined();
    expect(value.serviceTitle).toBe("Woodland Management Plan");
  });

  it("validates without a service title, since it's optional", () => {
    const { error } = validate(pageModel);

    expect(error).toBeUndefined();
  });

  it("fails when the service title is not a string", () => {
    const { error } = validate({ ...pageModel, serviceTitle: 1 });

    expect(error.message).toMatch(/"serviceTitle" must be a string/);
  });
});
