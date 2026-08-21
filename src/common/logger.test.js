import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { productionRedactPaths } from "./logger.js";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.super-secret-caller-token.signature";

// Capture what pino serializes by pointing it at an in-memory sink.
const captureLog = (logObject) => {
  const chunks = [];
  const sink = {
    write: (chunk) => {
      chunks.push(chunk);
      return true;
    },
  };

  const testLogger = pino(
    {
      redact: { paths: productionRedactPaths, remove: true },
      base: null,
    },
    sink,
  );

  testLogger.info(logObject);
  return chunks.join("");
};

describe("logger redaction (FGP-1307)", () => {
  it("lists the caller token header in the production redaction paths", () => {
    expect(productionRedactPaths).toContain('req.headers["x-encrypted-auth"]');
  });

  it("never serializes the caller token to logs", () => {
    const output = captureLog({
      req: {
        headers: {
          authorization: "Bearer service-token",
          "x-encrypted-auth": TOKEN,
          "x-agreement-sbi": "123456789",
        },
      },
    });

    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain("x-encrypted-auth");
  });
});
