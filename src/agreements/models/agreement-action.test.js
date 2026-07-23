import { describe, expect, it } from "vitest";
import { AgreementAction } from "./agreement-action.js";

const toAction = (validation) =>
  new AgreementAction({
    from: "offered",
    name: "accept",
    target: "accepted",
    validation,
  });

describe("AgreementAction", () => {
  it("returns its configured lifecycle transition", () => {
    expect(toAction().transition).toEqual({
      from: "offered",
      action: "accept",
      target: "accepted",
    });
  });

  it("returns its configured preparation page", () => {
    expect(toAction({ page: "accept" }).preparationPage).toBe("accept");
    expect(toAction().preparationPage).toBeUndefined();
  });

  it("accepts a submitted scalar value that matches the configured value", () => {
    const validation = {
      required: [
        {
          name: "declaration",
          value: "agreed",
          href: "#declaration",
          message: "Agree to the declaration",
        },
      ],
    };

    expect(toAction(validation).validate({ declaration: "agreed" })).toEqual({
      valid: true,
    });
  });

  it("accepts an array-valued field containing the configured value", () => {
    const validation = {
      required: [
        {
          name: "declarations",
          value: "terms",
          href: "#declarations",
          message: "Agree to the terms",
        },
      ],
    };

    expect(
      toAction(validation).validate({
        declarations: ["privacy", "terms"],
      }),
    ).toEqual({ valid: true });
  });

  it("passes when the action has no validation configuration", () => {
    expect(toAction().validate({})).toEqual({ valid: true });
  });

  it("returns every configured field failure in declaration order", () => {
    const validation = {
      page: "accept",
      required: [
        {
          name: "missing",
          value: "confirmed",
          href: "#missing",
          message: "Confirm the missing field",
        },
        {
          name: "empty",
          value: "confirmed",
          href: "#empty",
          message: "Confirm the empty field",
        },
        {
          name: "different",
          value: "confirmed",
          href: "#different",
          message: "Confirm the different field",
        },
      ],
    };

    expect(
      toAction(validation).validate({
        empty: "",
        different: "not-confirmed",
      }),
    ).toEqual({
      valid: false,
      page: "accept",
      errors: [
        {
          name: "missing",
          href: "#missing",
          message: "Confirm the missing field",
        },
        {
          name: "empty",
          href: "#empty",
          message: "Confirm the empty field",
        },
        {
          name: "different",
          href: "#different",
          message: "Confirm the different field",
        },
      ],
    });
  });
});
