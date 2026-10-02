import { describe, expect, it } from "vitest";
import { recordRefOf, resolveRecordRef, searchRefOf } from "./event-record.js";

describe("resolveRecordRef", () => {
  it.each([
    [
      "application.status.updated",
      { clientRef: "ref-1", grantCode: "woodland" },
    ],
    [
      "application.created and agreement events",
      { clientRef: "ref-1", code: "woodland" },
    ],
    ["case events", { caseRef: "ref-1", workflowCode: "woodland" }],
    ["a claim payment", { source: { clientRef: "ref-1", code: "woodland" } }],
  ])("reads the refs of %s", (_name, data) => {
    expect(resolveRecordRef(data)).toEqual({ ref: "ref-1", code: "woodland" });
  });

  it("takes the first rule that matches", () => {
    expect(
      resolveRecordRef({
        clientRef: "ref-1",
        grantCode: "grant",
        code: "code",
        caseRef: "case",
        workflowCode: "workflow",
      }),
    ).toEqual({ ref: "ref-1", code: "grant" });
  });

  it("keeps hyphenated refs and codes whole", () => {
    expect(
      resolveRecordRef({ clientRef: "a-b-c", code: "frps-private-beta" }),
    ).toEqual({ ref: "a-b-c", code: "frps-private-beta" });
  });

  it.each([
    ["a ref without a code", { clientRef: "ref-1" }],
    ["a grant-level event", { grantCode: "woodland" }],
    ["an agreement number only", { agreementNumber: "FPTT123" }],
    ["an empty ref", { clientRef: "", code: "woodland" }],
    ["no data", undefined],
  ])("finds nothing for %s", (_name, data) => {
    expect(resolveRecordRef(data)).toBeNull();
  });

  it("never reads inside a payload, answers or snapshot", () => {
    expect(
      resolveRecordRef({
        payload: { clientRef: "ref-1", code: "woodland" },
        answers: { clientRef: "ref-1", code: "woodland" },
        snapshot: { clientRef: "ref-1", code: "woodland" },
      }),
    ).toBeNull();
  });
});

describe("recordRefOf and searchRefOf", () => {
  const aDetail = (overrides = {}) => ({
    type: "case.create",
    segregationRef: "ref-1-woodland",
    payload: { data: { caseRef: "ref-1", workflowCode: "woodland" } },
    ...overrides,
  });

  it("read the event's own data and segregationRef", () => {
    expect(recordRefOf(aDetail())).toEqual({ ref: "ref-1", code: "woodland" });
    expect(searchRefOf(aDetail())).toBe("ref-1-woodland");
  });

  it("give an audit row neither", () => {
    const audit = aDetail({ type: "audit" });

    expect(recordRefOf(audit)).toBeNull();
    expect(searchRefOf(audit)).toBeNull();
  });

  it("cope with a null payload", () => {
    expect(recordRefOf(aDetail({ payload: null }))).toBeNull();
  });
});
