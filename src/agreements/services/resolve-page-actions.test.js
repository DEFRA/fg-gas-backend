import { describe, expect, it } from "vitest";
import { resolvePageActions } from "./resolve-page-actions.js";

const tree = (components) => [
  {
    component: "grid-row",
    components: [{ component: "grid-column", width: "two-thirds", components }],
  },
];

describe("resolvePageActions", () => {
  it("binds a GET action to exactly one button", () => {
    expect(
      resolvePageActions({
        components: tree([{ component: "button", actionId: "continue" }]),
        sections: [],
        actions: [
          {
            name: "continue",
            method: "GET",
            href: "/agreements/TST123/actions/continue",
            text: "Continue",
            classes: "govuk-button--secondary",
          },
        ],
      }),
    ).toEqual({
      components: tree([
        {
          component: "button",
          text: "Continue",
          href: "/agreements/TST123/actions/continue",
          classes: "govuk-button--secondary",
        },
      ]),
      sections: [],
    });
  });

  it("binds a POST action to one form and its nested submit button", () => {
    expect(
      resolvePageActions({
        components: tree([
          {
            component: "form",
            actionId: "accept",
            components: [
              { component: "checkboxes", name: "confirm", items: [] },
              { component: "button", actionId: "accept" },
            ],
          },
        ]),
        sections: [],
        actions: [
          {
            name: "accept",
            method: "POST",
            href: "/agreements/TST123/actions/accept",
            text: "Accept offer",
            fields: [{ name: "source", value: "agreement" }],
          },
        ],
      }),
    ).toEqual({
      components: tree([
        {
          component: "form",
          components: [
            { component: "checkboxes", name: "confirm", items: [] },
            { component: "button", text: "Accept offer", submit: true },
          ],
          method: "POST",
          formAction: "/agreements/TST123/actions/accept",
          hiddenFields: [{ name: "source", value: "agreement" }],
        },
      ]),
      sections: [],
    });
  });

  it.each([
    [
      "duplicate action names",
      tree([{ component: "button", actionId: "next" }]),
      [
        { name: "next", method: "GET", href: "/next", text: "Next" },
        { name: "next", method: "GET", href: "/again", text: "Again" },
      ],
    ],
    [
      "an unreferenced action",
      tree([{ component: "paragraph", text: "Hi" }]),
      [{ name: "next", method: "GET", href: "/next", text: "Next" }],
    ],
    [
      "a GET button inside a form",
      tree([
        {
          component: "form",
          actionId: "save",
          components: [{ component: "button", actionId: "next" }],
        },
      ]),
      [
        { name: "save", method: "POST", href: "/save", text: "Save" },
        { name: "next", method: "GET", href: "/next", text: "Next" },
      ],
    ],
    [
      "nested forms",
      tree([
        {
          component: "form",
          actionId: "save",
          components: [
            {
              component: "form",
              actionId: "other",
              components: [{ component: "button", actionId: "other" }],
            },
            { component: "button", actionId: "save" },
          ],
        },
      ]),
      [
        { name: "save", method: "POST", href: "/save", text: "Save" },
        { name: "other", method: "POST", href: "/other", text: "Other" },
      ],
    ],
  ])("rejects %s", (_name, components, actions) => {
    expect(() =>
      resolvePageActions({ components, sections: [], actions }),
    ).toThrow("Invalid agreement action bindings");
  });

  it("rejects a non-grid page root", () => {
    expect(() =>
      resolvePageActions({
        components: [{ component: "paragraph" }],
        sections: [],
        actions: [],
      }),
    ).toThrow("Agreement page must use an explicit component tree");
  });
});
