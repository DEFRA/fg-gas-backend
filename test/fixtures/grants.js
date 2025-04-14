export const grant1 = {
  code: "test-code-1",
  metadata: {
    description: "test description 1",
    startDate: "2100-01-01T00:00:00.000Z",
  },
  actions: [
    {
      name: "action1",
      method: "GET",
      url: "http://example.com",
    },
  ],
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

export const grant2 = {
  code: "test-code-2",
  metadata: {
    description: "test description 2",
    startDate: "2100-01-01T00:00:00.000Z",
  },
  actions: [
    {
      name: "action2",
      method: "GET",
      url: "http://example.com",
    },
  ],
  questions: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      question2: {
        type: "string",
        description: "This is another test question",
      },
    },
  },
};
