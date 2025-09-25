import { wreck } from "./wreck.js";

export const createGrant = async () => {
  const payload = {
    code: "test-code-1",
    metadata: {
      description: "test description 1",
      startDate: "2100-01-01T00:00:00.000Z",
    },
    actions: [],
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        question1: {
          type: "string",
          description: "This is a test question",
        },
      },
    },
  };

  await wreck.post("/grants", {
    json: true,
    payload,
  });
};
