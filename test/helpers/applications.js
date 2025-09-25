import { randomUUID } from "node:crypto";
import { wreck } from "../helpers/wreck.js";

export const submitApplication = async () => {
  const clientRef = `cr-12345-${randomUUID()}`;
  const code = "test-code-1";

  await wreck.post(`/grants/${code}/applications`, {
    headers: {
      "x-cdp-request-id": "xxxx-xxxx-xxxx-xxxx",
    },
    payload: {
      metadata: {
        clientRef,
        submittedAt: new Date().toISOString(),
        sbi: "1234567890",
        frn: "1234567890",
        crn: "1234567890",
        defraId: "1234567890",
      },
      answers: {
        question1: "test answer",
      },
    },
  });

  return { clientRef, code };
};
