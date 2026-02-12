import { describe, expect, it } from "vitest";
import { getMessageGroupId } from "./get-message-group-id.js";

describe("getMessageGroupId", () => {
  it("returns id when provided", () => {
    const result = getMessageGroupId("explicit-id", {
      clientRef: "CLIENT123",
      grantCode: "GRANT456",
    });

    expect(result).toBe("explicit-id");
  });

  it("combines clientRef and grantCode when id is not provided", () => {
    const result = getMessageGroupId(null, {
      clientRef: "CLIENT123",
      grantCode: "GRANT456",
    });

    expect(result).toBe("CLIENT123-GRANT456");
  });

  it("combines clientRef and code when grantCode is not provided", () => {
    const result = getMessageGroupId(undefined, {
      clientRef: "CLIENT123",
      code: "CODE789",
    });

    expect(result).toBe("CLIENT123-CODE789");
  });

  it("combines caseRef and workflowCode when clientRef is not provided", () => {
    const result = getMessageGroupId("", {
      caseRef: "CASE321",
      workflowCode: "WF654",
    });

    expect(result).toBe("CASE321-WF654");
  });

  it("returns id when data does not contain expected fields", () => {
    const result = getMessageGroupId("fallback-id", {
      foo: "bar",
    });

    expect(result).toBe("fallback-id");
  });
});
