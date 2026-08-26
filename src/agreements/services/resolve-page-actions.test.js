import { describe, expect, it } from "vitest";
import { resolvePageActions } from "./resolve-page-actions.js";

const agreement = { agreementNumber: "PMF123", state: "offered" };
const agreementDefinition = {
  resolveAction: ({ state, action }) => {
    expect(state).toBe("offered");
    expect(["accept", "review"]).toContain(action);

    return {
      submissionRequirements:
        action === "accept" ? [{ name: "confirm", value: "confirmed" }] : [],
    };
  },
};

const tree = (components) => [
  {
    component: "grid-row",
    components: [{ component: "grid-column", width: "two-thirds", components }],
  },
];

describe("resolvePageActions", () => {
  it("resolves a configured GET action button", () => {
    expect(
      resolvePageActions(
        {
          components: tree([
            { component: "button", action: "accept", text: "Continue" },
          ]),
        },
        agreement,
        agreementDefinition,
      ),
    ).toEqual({
      components: tree([
        {
          component: "button",
          text: "Continue",
          href: "/agreements/PMF123/actions/accept",
        },
      ]),
      sections: [],
    });
  });

  it("resolves a configured POST form and preserves its content", () => {
    expect(
      resolvePageActions(
        {
          components: tree([
            {
              component: "form",
              action: "accept",
              hiddenFields: [{ name: "source", value: "offer" }],
              components: [
                { component: "checkboxes", name: "confirm", items: [] },
                { component: "button", text: "Accept agreement offer" },
              ],
            },
          ]),
          sections: [
            {
              id: "terms",
              title: "Terms",
              components: tree([
                { component: "button", action: "review", text: "Review" },
              ]),
            },
          ],
        },
        agreement,
        agreementDefinition,
      ),
    ).toEqual({
      components: tree([
        {
          component: "form",
          method: "POST",
          formAction: "/agreements/PMF123/actions/accept",
          hiddenFields: [{ name: "source", value: "offer" }],
          submissionRequirements: [{ name: "confirm", value: "confirmed" }],
          components: [
            { component: "checkboxes", name: "confirm", items: [] },
            {
              component: "button",
              text: "Accept agreement offer",
              submit: true,
            },
          ],
        },
      ]),
      sections: [
        {
          id: "terms",
          title: "Terms",
          components: tree([
            {
              component: "button",
              text: "Review",
              href: "/agreements/PMF123/actions/review",
            },
          ]),
        },
      ],
    });
  });
});
