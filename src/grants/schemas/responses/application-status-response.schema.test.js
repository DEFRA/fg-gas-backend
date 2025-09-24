import { describe, expect, it } from "vitest";
import { applicationStatusResponseSchema } from "./application-status-response.schema.js";

describe("application status response schema", () => {
  it("should validate a response", async () => {
    const response = {
      grantCode: "frps-private-beta",
      clientRef: "ref-123",
      phase: "PRE_AWARD",
      stage: "REVIEW",
      status: "APPROVED",
    };

    const { error } = applicationStatusResponseSchema.validate(response);

    expect(error).toBeUndefined();
  });

  it("should throw an error if a response status is not valid", async () => {
    const response = {
      grantCode: "frps-private-beta",
      clientRef: "ref-123",
      phase: "PRE_AWARD",
      stage: "REVIEW",
      status: "N0T_VAL1D_STATU$$",
    };

    const { error } = applicationStatusResponseSchema.validate(response);

    expect(error.details[0].message).toBe(
      '"status" with value "N0T_VAL1D_STATU$$" fails to match the required pattern: /^[A-Z_]+$/',
    );
  });

  it("should throw an error if a response stage is not valid", async () => {
    const response = {
      grantCode: "frps-private-beta",
      clientRef: "ref-123",
      phase: "PRE_AWARD",
      stage: "N0T VAL1D &&",
      status: "APPROVED",
    };

    const { error } = applicationStatusResponseSchema.validate(response);

    expect(error.details[0].message).toBe(
      '"stage" with value "N0T VAL1D &&" fails to match the required pattern: /^[A-Z_]+$/',
    );
  });

  it("should throw an error if a response phase is not valid", async () => {
    const response = {
      grantCode: "frps-private-beta",
      clientRef: "ref-123",
      phase: "&^gGHAK--dc01",
      stage: "AWARD",
      status: "APPROVED",
    };

    const { error } = applicationStatusResponseSchema.validate(response);

    expect(error.details[0].message).toBe(
      '"phase" with value "&^gGHAK--dc01" fails to match the required pattern: /^[A-Z_]+$/',
    );
  });

  it("should throw an error if a response grantCode or clientRef is not valid", async () => {
    const response = {
      grantCode: "___)9090sd",
      clientRef: "ref-123",
      phase: "PHASE_ONE",
      stage: "AWARD",
      status: "APPROVED",
    };

    const { error } = applicationStatusResponseSchema.validate(response);

    expect(error.details[0].message).toBe(
      '"grantCode" with value "___)9090sd" fails to match the required pattern: /^[a-z0-9-]+$/',
    );
  });

  it("should throw an error if a response grantCode or clientRef is not valid", async () => {
    const response = {
      grantCode: "grant-01",
      clientRef: "ref-123_++**&",
      phase: "PHASE_ONE",
      stage: "AWARD",
      status: "APPROVED",
    };

    const { error } = applicationStatusResponseSchema.validate(response);

    expect(error.details[0].message).toBe(
      '"clientRef" with value "ref-123_++**&" fails to match the required pattern: /^[a-z0-9-]+$/',
    );
  });
});
