import { describe, expect, it } from "vitest";
import { applyActionValidation } from "./apply-action-validation.js";

describe("applyActionValidation", () => {
  it("applies configured validation independently of Agreement code and field names", () => {
    const pageModel = {
      agreement: {
        agreementNumber: "WDL123",
        code: "woodland-offer",
        version: 3,
      },
      page: { name: "preferences", title: "Woodland preferences" },
      components: [
        {
          component: "checkboxes",
          name: "habitatOptions",
          items: [
            { value: "wetland", text: "Wetland" },
            { divider: "or" },
            { value: "grassland", text: "Grassland" },
          ],
        },
      ],
      actions: [],
    };

    expect(
      applyActionValidation({
        pageModel,
        values: { habitatOptions: ["grassland"] },
        errors: [
          {
            name: "habitatOptions",
            href: "#habitat-options",
            message: "Select all required habitats",
          },
        ],
      }),
    ).toEqual({
      ...pageModel,
      components: [
        {
          component: "checkboxes",
          name: "habitatOptions",
          errorMessage: { text: "Select all required habitats" },
          items: [
            { value: "wetland", text: "Wetland", checked: false },
            { divider: "or" },
            { value: "grassland", text: "Grassland", checked: true },
          ],
        },
      ],
      values: { habitatOptions: ["grassland"] },
      errors: [
        {
          href: "#habitat-options",
          text: "Select all required habitats",
        },
      ],
    });
  });
});
