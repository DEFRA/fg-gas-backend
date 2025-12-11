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
  phases: [
    {
      code: "PRE_AWARD",
      stages: [
        {
          code: "ASSESSMENT",
          statuses: [
            { code: "RECEIVED", validFrom: [] },
            { code: "REVIEW", validFrom: [] },
          ],
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
    },
  ],
};

export const grant2 = {
  code: "test-code-2",
  metadata: {
    description: "test description 2",
    startDate: "2010-01-01T00:00:00.000Z",
  },
  actions: [
    {
      name: "action2",
      method: "GET",
      url: "http://example.com",
    },
  ],
  phases: [
    {
      code: "PRE_AWARD",
      stages: [
        {
          code: "ASSESSMENT",
          statuses: [
            { code: "RECEIVED", validFrom: [] },
            { code: "REVIEW", validFrom: [] },
          ],
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
    },
  ],
};

export const grant3 = {
  code: "test-code-3",
  metadata: {
    description: "test description 3",
    startDate: "2100-01-01T00:00:00.000Z",
  },
  actions: [
    {
      name: "action3",
      method: "GET",
      url: "http://example.com",
    },
  ],
  phases: [
    {
      code: "PRE_AWARD",
      stages: [
        {
          code: "ASSESSMENT",
          statuses: [
            { code: "RECEIVED", validFrom: [] },
            { code: "REVIEW", validFrom: [] },
          ],
        },
      ],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
        required: [
          "scheme",
          "year",
          "hasCheckedLandIsUpToDate",
          "actionApplications",
        ],
        properties: {
          scheme: {
            type: "string",
            title: "Defra scheme name",
          },
          year: {
            type: "integer",
            title: "Scheme year",
          },
          hasCheckedLandIsUpToDate: {
            type: "boolean",
            title:
              "Has the applicant checked that their land data is up to date?",
          },
          actionApplications: {
            type: "array",
            title: "Details of the actions applied for",
            minItems: 1,
            items: {
              $ref: "#/$defs/ActionApplication",
            },
          },
        },
        $defs: {
          ActionApplication: {
            type: "object",
            additionalProperties: false,
            required: ["parcelId", "sheetId", "code", "appliedFor"],
            properties: {
              parcelId: {
                type: "string",
                title: "Land parcel ID, unique within a OS Sheet ID",
                pattern: "^\\d+$",
              },
              sheetId: {
                type: "string",
                title: "OS Sheet ID",
                pattern: "[A-Z]{2}[0-9]{4}",
              },
              code: {
                type: "string",
                title: "Code for the action to be taken on the land parcel",
              },
              appliedFor: {
                type: "object",
                additionalProperties: false,
                required: ["unit", "quantity"],
                properties: {
                  unit: {
                    type: "string",
                    title: "Unit of measurement",
                    enum: ["kg", "m", "100m", "count", "ha", "m2"],
                  },
                  quantity: {
                    type: "number",
                    title: "Quantity of units applied for",
                  },
                },
              },
            },
          },
        },
      },
    },
  ],
};
