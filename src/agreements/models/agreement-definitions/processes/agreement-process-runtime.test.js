import Boom from "@hapi/boom";
import Joi from "joi";
import { describe, expect, it, vi } from "vitest";
import { Agreement } from "../../agreement.js";
import { AgreementDefinition } from "../agreement-definition.js";
import { createAgreementProcessHandlers } from "./agreement-process-registries.js";

const createDefinition = () => ({
  code: "test-processes",
  configVersion: "1.0.0",
  agreementNumberPrefix: "TST",
  processDefinitions: {
    "calculate-offer": {
      type: "endpoint",
      endpoint: {
        method: "POST",
        path: "/calculate",
        service: "CALCULATOR",
      },
      request: { body: { quantity: "$.application.quantity" } },
      output: { totalAmountPence: "$.response.totalAmountPence" },
    },
  },
  create: {
    target: "offered",
    application: "$.input",
    values: { actions: [], items: [] },
    processes: ["calculate-offer"],
  },
  states: { offered: { page: "offered" }, accepted: { page: "offered" } },
  pages: {
    offered: {
      title: "Offer",
      components: [{ component: "heading", text: "Offer" }],
    },
  },
});

const execution = {
  correlationId: "creation-correlation-id",
  executedAt: "2026-08-06T12:00:00.000Z",
  executionId: "execution-1",
};

const paymentSchedule = {
  instalments: [
    {
      id: "instalment:1",
      dueDate: "2026-11-06",
      totalAmountPence: 32000,
      lineItems: [{ actionId: "action:1", amountPence: 32000 }],
    },
  ],
};

const paymentAgreementValues = {
  startDate: "2026-08-06",
  endDate: "2027-08-05",
  actions: [{ id: "action:1", code: "largeWhite" }],
  items: [],
  totalAmountPence: 32000,
  paymentSchedule,
};

const paymentConfiguration = {
  sbi: "106284736",
  frn: "1101234567",
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  originalInvoiceNumber: "",
  ledger: "AP",
  totalAmountPence: 32000,
  currency: "GBP",
  marketingYear: "2026",
  payments: [
    {
      dueDate: "2026-11-06",
      totalAmountPence: 32000,
      invoiceLines: [
        {
          schemeCode: "CMOR1",
          description: "Large White Pig",
          amountPence: 32000,
          accountCode: "SOS710",
          fundCode: "DRD10",
          deliveryBody: "RP00",
          marketingYear: "2026",
        },
      ],
    },
  ],
};

const paymentDependencies = (configuration = paymentConfiguration) => ({
  handlers: createAgreementProcessHandlers({
    prepareAgreementPayment: () => ({
      commitOperations: [
        {
          type: "create-agreement-payment",
          request: { paymentConfiguration: configuration },
        },
      ],
    }),
  }),
});

const addTransition = (definition, processes, target = "offered") => {
  definition.states.offered.on = {
    accept: { target, processes },
  };
};

const optionOr = (value, fallback) => value ?? fallback;

const handlerDependencies = (name, options = {}) => ({
  handlers: {
    [name]: {
      inputSchema: optionOr(options.inputSchema, Joi.object().unknown(true)),
      commitOperationsSchema: options.commitOperationsSchema,
      execute: optionOr(options.execute, vi.fn()),
      locations: optionOr(options.locations, ["transition"]),
    },
  },
});

const runCreate = (definition) =>
  definition.createAgreement({
    input: {
      code: "test-processes",
      clientRef: "test-client-ref",
      identifiers: { sbi: "300000069" },
      quantity: 5,
    },
    execution,
  });

const toAgreement = (values = {}) =>
  new Agreement({
    agreementNumber: "TST123456789",
    version: 1,
    code: "test-processes",
    clientRef: "test-client-ref",
    configVersion: "1.0.0",
    correlationId: "creation-correlation-id",
    identifiers: { sbi: "300000069" },
    application: {},
    actions: [],
    items: [],
    state: "offered",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...values,
  });

const executeAction = (definition, agreement, values = {}) =>
  definition.executeAction({
    agreement,
    actionName: "accept",
    values,
    execution,
  });

describe("AgreementDefinition Process runtime", () => {
  it("maps, validates and isolates creation endpoint output", async () => {
    const callEndpoint = vi.fn().mockResolvedValue({
      totalAmountPence: 32000,
      unusedRawField: "discarded",
    });
    const definition = new AgreementDefinition(createDefinition(), {
      callEndpoint,
      generateAgreementNumber: () => "TST123456789",
    });

    await expect(runCreate(definition)).resolves.toMatchObject({
      agreementNumber: "TST123456789",
      totalAmountPence: 32000,
    });
    expect(callEndpoint).toHaveBeenCalledWith(
      {
        code: "calculate-offer",
        method: "POST",
        path: "/calculate",
        service: "CALCULATOR",
      },
      { BODY: { quantity: 5 } },
    );
  });

  it("analyses and resolves JSONata row expressions consistently", async () => {
    const definitionData = createDefinition();
    definitionData.processDefinitions["calculate-offer"].output = {
      actions: {
        itemsRef: "$.response.actions",
        items: {
          code: "@.code",
          ratePence: "jsonata:$round(@.rate * 100)",
        },
      },
    };
    const callEndpoint = vi.fn().mockResolvedValue({
      actions: [{ code: "PMF1", rate: 12.5 }],
    });
    delete definitionData.create.values.actions;
    const definition = new AgreementDefinition(definitionData, {
      callEndpoint,
      generateAgreementNumber: () => "TST123456789",
    });

    await expect(runCreate(definition)).resolves.toMatchObject({
      actions: [{ id: "action:1", code: "PMF1", ratePence: 1250 }],
    });
  });

  it("runs transition Processes sequentially with validated dependencies", async () => {
    const definitionData = createDefinition();
    definitionData.processDefinitions["calculate-payment"] = {
      type: "endpoint",
      endpoint: {
        method: "POST",
        path: "/payment-schedule",
        service: "CALCULATOR",
      },
      request: {
        body: {
          amount: "$.agreement.totalAmountPence",
          confirmation: "$.transition.values.confirm",
          transition: "$.transition.name",
        },
      },
      output: { paymentSchedule: "$.response.paymentSchedule" },
    };
    definitionData.processDefinitions["record-payment"] = {
      type: "handler",
      input: {
        paymentSchedule:
          'jsonata:$lookup($.outputs, "calculate-payment").paymentSchedule',
      },
    };
    addTransition(
      definitionData,
      ["calculate-payment", "record-payment"],
      "accepted",
    );
    definitionData.states.accepted = { page: "offered" };

    const candidatePaymentSchedule = {
      instalments: [
        {
          dueDate: "2026-11-06",
          totalAmountPence: 32000,
          lineItems: [{ actionRef: "offer-line-1", amountPence: 32000 }],
        },
      ],
    };
    const calls = [];
    const callEndpoint = vi.fn().mockImplementation(async () => {
      calls.push("calculate-payment");
      return { paymentSchedule: candidatePaymentSchedule };
    });
    const execute = vi.fn().mockImplementation(() => {
      calls.push("record-payment");
    });
    const definition = new AgreementDefinition(definitionData, {
      callEndpoint,
      ...handlerDependencies("record-payment", {
        execute,
        inputSchema: Joi.object({
          paymentSchedule: Joi.object().unknown(true).required(),
        }),
      }),
    });
    const agreement = toAgreement({ totalAmountPence: 32000 });
    const result = await executeAction(definition, agreement, {
      confirm: "confirmed",
    });

    expect(calls).toEqual(["calculate-payment", "record-payment"]);
    expect(callEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ code: "calculate-payment" }),
      {
        BODY: {
          amount: 32000,
          confirmation: "confirmed",
          transition: "accept",
        },
      },
    );
    expect(execute).toHaveBeenCalledWith({
      agreement,
      execution: { ...execution, location: "transition", target: "accepted" },
      input: { paymentSchedule: candidatePaymentSchedule },
    });
    expect(result).toMatchObject({
      agreement: { state: "accepted", version: 2 },
      commitOperations: [],
    });
  });

  it("deep-clones values at Process boundaries", async () => {
    const definitionData = createDefinition();
    definitionData.processDefinitions.mutate = {
      type: "handler",
      input: { nested: "$.agreement.application.nested" },
    };
    addTransition(definitionData, ["mutate"]);
    const execute = vi
      .fn()
      .mockImplementation(({ agreement, execution, input }) => {
        agreement.application.nested.value = 2;
        execution.executedAt = "changed";
        input.nested.value = 3;
      });
    const definition = new AgreementDefinition(definitionData, {
      ...handlerDependencies("mutate", {
        execute,
        inputSchema: Joi.object({ nested: Joi.object().required() }),
      }),
    });
    const agreement = toAgreement({
      application: { nested: { value: 1 } },
    });
    const executionFacts = structuredClone(execution);

    await definition.executeAction({
      agreement,
      actionName: "accept",
      values: {},
      execution: executionFacts,
    });

    expect(agreement.application.nested.value).toBe(1);
    expect(executionFacts).toEqual(execution);
  });

  it("runs allowed page Processes and converts typed output", async () => {
    const definitionData = createDefinition();
    definitionData.processDefinitions["load-page-data"] = {
      type: "endpoint",
      endpoint: { method: "GET", path: "/page-data", service: "READ_MODEL" },
      request: { body: { state: "$.agreement.state" } },
      output: { actions: "$.response.actions" },
    };
    definitionData.states.offered.processes = ["load-page-data"];
    const callEndpoint = vi.fn().mockResolvedValue({
      actions: [{ code: "PMF1", quantity: "5", unit: "head" }],
    });
    const definition = new AgreementDefinition(definitionData, {
      callEndpoint,
    });

    await expect(
      definition.runPageProcesses({
        agreement: toAgreement(),
        page: "offered",
        execution,
      }),
    ).resolves.toEqual({
      outputs: {
        "load-page-data": {
          actions: [{ code: "PMF1", quantity: 5, unit: "head" }],
        },
      },
    });
    expect(callEndpoint).toHaveBeenCalledOnce();
  });

  it("rejects values outside the page Process context", async () => {
    const callEndpoint = vi.fn();
    const definition = new AgreementDefinition(createDefinition(), {
      callEndpoint,
    });

    await expect(
      definition.runPageProcesses({
        agreement: toAgreement(),
        page: "offered",
        execution: { ...execution, application: { quantity: 5 } },
      }),
    ).rejects.toMatchObject({
      message:
        "Invalid Agreement Process page context at: execution.application",
      output: { statusCode: 500 },
    });
    expect(callEndpoint).not.toHaveBeenCalled();
  });

  it("rejects a transition Process context missing transition values", async () => {
    const definitionData = createDefinition();
    addTransition(definitionData, []);
    const definition = new AgreementDefinition(definitionData);

    await expect(
      definition.executeAction({
        agreement: toAgreement(),
        actionName: "accept",
        execution,
      }),
    ).rejects.toMatchObject({
      message:
        "Invalid Agreement Process transition context at: transition.values",
      output: { statusCode: 500 },
    });
  });

  it("rejects commit operations produced while preparing a page", async () => {
    const definitionData = createDefinition();
    definitionData.processDefinitions.stage = {
      type: "handler",
      input: {},
    };
    definitionData.states.offered.processes = ["stage"];
    const commitOperationsSchema = Joi.object({
      commitOperations: Joi.array()
        .items(Joi.object({ type: Joi.string().required() }))
        .required(),
    });
    const definition = new AgreementDefinition(definitionData, {
      ...handlerDependencies("stage", {
        execute: () => ({
          commitOperations: [{ type: "unsupported" }],
        }),
        commitOperationsSchema,
        locations: ["page"],
      }),
    });

    await expect(
      definition.runPageProcesses({
        agreement: toAgreement(),
        page: "offered",
        execution,
      }),
    ).rejects.toThrow(
      "Agreement page Processes produced unsupported commit operations",
    );
  });

  it("checks page access before running a Process", async () => {
    const definitionData = createDefinition();
    definitionData.states.offered.processes = ["calculate-offer"];
    definitionData.pages.hidden = {
      title: "Hidden",
      components: [{ component: "heading", text: "Hidden" }],
    };
    const callEndpoint = vi.fn();
    const definition = new AgreementDefinition(definitionData, {
      callEndpoint,
    });

    await expect(
      definition.runPageProcesses({
        agreement: toAgreement(),
        page: "hidden",
        execution,
      }),
    ).rejects.toMatchObject({ output: { statusCode: 403 } });
    expect(callEndpoint).not.toHaveBeenCalled();
  });

  it("keeps the generic Process runtime private", () => {
    const definition = new AgreementDefinition(createDefinition());

    expect(definition.runProcesses).toBeUndefined();
  });

  it("stops after an endpoint failure", async () => {
    const definitionData = createDefinition();
    definitionData.processDefinitions["load-actions"] = {
      type: "endpoint",
      endpoint: { method: "GET", path: "/actions", service: "READ_MODEL" },
      request: { body: {} },
      output: { actions: "$.response.actions" },
    };
    definitionData.create.processes.push("load-actions");
    delete definitionData.create.values.actions;
    const callEndpoint = vi
      .fn()
      .mockRejectedValue(Boom.badGateway("calculator unavailable"));
    const definition = new AgreementDefinition(definitionData, {
      callEndpoint,
    });

    await expect(runCreate(definition)).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
    expect(callEndpoint).toHaveBeenCalledOnce();
  });

  it("redacts malformed endpoint responses", async () => {
    const definition = new AgreementDefinition(createDefinition(), {
      callEndpoint: vi.fn().mockResolvedValue({ secret: "calculator detail" }),
    });

    await expect(runCreate(definition)).rejects.toMatchObject({
      message: expect.stringMatching(/calculate-offer.*malformed response/),
      output: { statusCode: 502 },
    });
  });

  it("stages a typed Payment commit operation without writing", async () => {
    const definitionData = createDefinition();
    definitionData.processDefinitions.CREATE_AGREEMENT_PAYMENT = {
      type: "handler",
    };
    addTransition(definitionData, ["CREATE_AGREEMENT_PAYMENT"]);
    const definition = new AgreementDefinition(
      definitionData,
      paymentDependencies(),
    );

    await expect(
      executeAction(definition, toAgreement(paymentAgreementValues)),
    ).resolves.toMatchObject({
      agreement: { state: "offered", version: 2 },
      commitOperations: [
        {
          type: "create-agreement-payment",
          request: { paymentConfiguration },
        },
      ],
    });
  });

  it("rejects commit operations produced during Agreement creation", async () => {
    const definitionData = createDefinition();
    definitionData.processDefinitions.stage = {
      type: "handler",
      input: {},
    };
    definitionData.create.processes = ["stage"];
    const commitOperationsSchema = Joi.object({
      commitOperations: Joi.array()
        .items(Joi.object({ type: Joi.string().required() }))
        .required(),
    });
    const definition = new AgreementDefinition(definitionData, {
      generateAgreementNumber: () => "TST123456789",
      ...handlerDependencies("stage", {
        execute: () => ({
          commitOperations: [{ type: "unsupported" }],
        }),
        commitOperationsSchema,
        locations: ["create"],
      }),
    });

    await expect(runCreate(definition)).rejects.toThrow(
      "Agreement creation Processes produced unsupported commit operations",
    );
  });
});

const consumerProcess = (mapping) => ({
  type: "handler",
  input: { value: mapping },
});

const consumerDependencies = (location = "transition") =>
  handlerDependencies("consume", { locations: [location] });

const inheritedRegistryNames = ["toString", "constructor", "__proto__"];

const inheritedProcessReferenceCases = inheritedRegistryNames.map((name) => [
  `inherited Process reference "${name}"`,
  () => {
    const definition = createDefinition();
    definition.create.processes = [name];
    return { definition };
  },
  new RegExp(`${name}.*not defined`),
]);

const inheritedHandlerReferenceCases = inheritedRegistryNames.map((name) => [
  `inherited handler reference "${name}"`,
  () => {
    const definition = createDefinition();
    definition.processDefinitions = Object.fromEntries([
      ...Object.entries(definition.processDefinitions),
      [name, { type: "handler", input: {} }],
    ]);
    definition.create.processes = [name];
    return { definition };
  },
  new RegExp(`${name}.*(?:no registered handler|not defined)`),
]);

const inheritedOutputReferenceCases = inheritedRegistryNames.map((name) => [
  `inherited output reference "${name}"`,
  () => {
    const definition = createDefinition();
    definition.processDefinitions["calculate-offer"].output =
      Object.fromEntries([[name, "$.response.value"]]);
    return { definition };
  },
  new RegExp(`unknown output.*${name}`),
]);

const compilationCases = [
  ...inheritedProcessReferenceCases,
  ...inheritedHandlerReferenceCases,
  ...inheritedOutputReferenceCases,
  [
    "unknown Process references",
    () => {
      const definition = createDefinition();
      definition.create.processes = ["missing"];
      return { definition };
    },
    /create\.processes.*missing.*not defined/,
  ],
  [
    "mixed Effects and Processes",
    () => {
      const definition = createDefinition();
      definition.create.effects = [{ name: "snapshot" }];
      return { definition };
    },
    /effects.*not allowed/i,
  ],
  [
    "duplicate Processes",
    () => {
      const definition = createDefinition();
      definition.create.processes.push("calculate-offer");
      return { definition };
    },
    /calculate-offer.*more than once/,
  ],
  [
    "competing output producers",
    () => {
      const definition = createDefinition();
      definition.processDefinitions.recalculate = structuredClone(
        definition.processDefinitions["calculate-offer"],
      );
      definition.create.processes.push("recalculate");
      return { definition };
    },
    /totalAmountPence.*competing producers/,
  ],
  [
    "dependencies that do not occur earlier",
    () => {
      const definition = createDefinition();
      definition.processDefinitions.consume = consumerProcess(
        'jsonata:$lookup($.outputs, "calculate-offer").totalAmountPence',
      );
      addTransition(definition, ["consume"]);
      return { definition, dependencies: consumerDependencies() };
    },
    /consume.*calculate-offer.*earlier/,
  ],
  [
    "dependencies on missing producer outputs",
    () => {
      const definition = createDefinition();
      definition.processDefinitions.consume = consumerProcess(
        'jsonata:$lookup($.outputs, "calculate-offer").actions',
      );
      definition.create.processes.push("consume");
      return { definition, dependencies: consumerDependencies("create") };
    },
    /calculate-offer.*does not produce output.*actions/,
  ],
  [
    "computed output dependencies",
    () => {
      const definition = createDefinition();
      definition.processDefinitions["calculate-offer"].request.body = {
        value: "jsonata:$lookup($.outputs, $.execution.target)",
      };
      return { definition };
    },
    /Dynamic Agreement Process output lookup/,
  ],
  [
    "indirect output root lookups",
    () => {
      const definition = createDefinition();
      definition.processDefinitions["calculate-offer"].request.body = {
        value:
          'jsonata:$lookup($lookup($, "outputs"), "calculate-offer").totalAmountPence',
      };
      return { definition };
    },
    /output lookup must target.*outputs/,
  ],
  [
    "output access hidden in strings",
    () => {
      const definition = createDefinition();
      definition.processDefinitions["calculate-offer"].request.body = {
        value: 'jsonata:$eval("$.outputs.calculateOffer")',
      };
      return { definition };
    },
    /output access cannot be hidden in a string/,
  ],
  [
    "unsupported nested output lookups",
    () => {
      const definition = createDefinition();
      definition.processDefinitions.consume = consumerProcess(
        'jsonata:$lookup($.outputs.calculate-offer, "totalAmountPence")',
      );
      definition.create.processes.push("consume");
      return { definition, dependencies: consumerDependencies("create") };
    },
    /output lookup must target.*outputs/,
  ],
  [
    "handlers at unsupported locations",
    () => {
      const definition = createDefinition();
      definition.processDefinitions["transition-only"] = {
        type: "handler",
        input: {},
      };
      definition.create.processes = ["transition-only"];
      return {
        definition,
        dependencies: handlerDependencies("transition-only"),
      };
    },
    /transition-only.*not allowed.*create/,
  ],
  [
    "malformed JSONata",
    () => {
      const definition = createDefinition();
      definition.processDefinitions["calculate-offer"].request.body = {
        value: "jsonata:(",
      };
      return { definition };
    },
    /calculate-offer.*request\.body.*invalid mapping/,
  ],
  [
    "unknown typed outputs",
    () => {
      const definition = createDefinition();
      definition.processDefinitions["calculate-offer"].output = {
        agreementNumber: "$.response.agreementNumber",
      };
      return { definition };
    },
    /unknown output.*agreementNumber/,
  ],
  [
    "unknown typed output fields",
    () => {
      const definition = createDefinition();
      definition.processDefinitions["calculate-offer"].output = {
        actions: {
          itemsRef: "$.response.actions",
          items: { code: "@.code", unknown: "@.unknown" },
        },
      };
      return { definition };
    },
    /actions.*unknown.*unknown/,
  ],
  [
    "persistent output identities",
    () => {
      const definition = createDefinition();
      definition.processDefinitions["calculate-offer"].output = {
        actions: {
          itemsRef: "$.response.actions",
          items: { id: "@.id", code: "@.code" },
        },
      };
      return { definition };
    },
    /actions\.id.*unknown/,
  ],
  [
    "persistent Instalment identities",
    () => {
      const definition = createDefinition();
      definition.processDefinitions["calculate-offer"].output = {
        paymentSchedule: {
          instalments: {
            itemsRef: "$.response.payments",
            items: {
              id: "@.id",
              dueDate: "@.dueDate",
              totalAmountPence: "@.totalAmountPence",
              lineItems: [],
            },
          },
        },
      };
      return { definition };
    },
    /instalments\.id.*unknown/,
  ],
  [
    "persistent scheduled Line Item references",
    () => {
      const definition = createDefinition();
      definition.processDefinitions["calculate-offer"].output = {
        paymentSchedule: {
          instalments: {
            itemsRef: "$.response.payments",
            items: {
              dueDate: "@.dueDate",
              totalAmountPence: "@.totalAmountPence",
              lineItems: {
                itemsRef: "@.lineItems",
                items: {
                  actionId: "@.actionId",
                  amountPence: "@.amountPence",
                },
              },
            },
          },
        },
      };
      return { definition };
    },
    /lineItems\.actionId.*unknown/,
  ],
  [
    "inline Payment configuration",
    () => {
      const definition = createDefinition();
      definition.processDefinitions.CREATE_AGREEMENT_PAYMENT = {
        type: "handler",
        input: { payment: paymentConfiguration },
      };
      return { definition };
    },
    /input\.payment.*unknown/,
  ],
];

describe("AgreementDefinition Process compilation", () => {
  it.each(compilationCases)("rejects %s", (_name, arrange, expected) => {
    const { definition, dependencies } = arrange();

    expect(() => new AgreementDefinition(definition, dependencies)).toThrow(
      expected,
    );
  });
});
