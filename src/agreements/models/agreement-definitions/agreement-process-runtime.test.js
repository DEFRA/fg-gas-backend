import Boom from "@hapi/boom";
import Joi from "joi";
import { describe, expect, it, vi } from "vitest";
import { AgreementDefinition } from "./agreement-definition.js";

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
    processes: ["calculate-offer"],
  },
  states: { offered: { page: "offered" } },
  pages: {
    offered: {
      title: "Offer",
      components: [{ component: "heading", text: "Offer" }],
    },
  },
});

const execution = {
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

const paymentHandlerInput = {
  agreementValues: {
    startDate: "2026-08-06",
    endDate: "2027-08-05",
    actions: [{ id: "action:1", code: "largeWhite" }],
    items: [],
    totalAmountPence: 32000,
    paymentSchedule,
  },
  payment: {
    scheme: "SFI",
    sourceSystem: "FPTT",
    deliveryBody: "RP00",
    fesCode: "FALS_FPTT",
    ledger: "AP",
    currency: "GBP",
    invoiceLine: { accountCode: "SOS710", fundCode: "DRD10" },
  },
};

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
      execute: optionOr(options.execute, vi.fn()),
      locations: optionOr(options.locations, ["transition"]),
    },
  },
});

const runCreate = (definition) =>
  definition.runProcesses({
    location: { type: "create" },
    context: { application: { quantity: 5 }, execution },
  });

describe("AgreementDefinition Process runtime", () => {
  it("maps, validates and isolates creation endpoint output", async () => {
    const callEndpoint = vi.fn().mockResolvedValue({
      totalAmountPence: 32000,
      unusedRawField: "discarded",
    });
    const definition = new AgreementDefinition(createDefinition(), {
      callEndpoint,
    });

    await expect(runCreate(definition)).resolves.toEqual({
      outputs: {
        "calculate-offer": { totalAmountPence: 32000 },
      },
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

    const calls = [];
    const callEndpoint = vi.fn().mockImplementation(async () => {
      calls.push("calculate-payment");
      return { paymentSchedule };
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
    const agreement = { state: "offered", totalAmountPence: 32000 };
    const result = await definition.runProcesses({
      location: {
        type: "transition",
        state: "offered",
        transition: "accept",
      },
      context: {
        agreement,
        transition: { values: { confirm: "confirmed" } },
        execution,
      },
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
      input: {
        paymentSchedule: result.outputs["calculate-payment"].paymentSchedule,
      },
    });
    expect(result.outputs["record-payment"]).toEqual({});
  });

  it("deep-clones values at Process boundaries", async () => {
    const definitionData = createDefinition();
    definitionData.processDefinitions.mutate = {
      type: "handler",
      input: { nested: "$.agreement.nested" },
    };
    addTransition(definitionData, ["mutate"]);
    const execute = vi
      .fn()
      .mockImplementation(({ agreement, execution, input }) => {
        agreement.nested.value = 2;
        execution.executedAt = "changed";
        input.nested.value = 3;
      });
    const definition = new AgreementDefinition(definitionData, {
      ...handlerDependencies("mutate", {
        execute,
        inputSchema: Joi.object({ nested: Joi.object().required() }),
      }),
    });
    const agreement = { state: "offered", nested: { value: 1 } };
    const executionFacts = structuredClone(execution);

    await definition.runProcesses({
      location: {
        type: "transition",
        state: "offered",
        transition: "accept",
      },
      context: {
        agreement,
        transition: { values: {} },
        execution: executionFacts,
      },
    });

    expect(agreement.nested.value).toBe(1);
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
    definitionData.pages.offered.processes = ["load-page-data"];
    const callEndpoint = vi.fn().mockResolvedValue({
      actions: [{ code: "PMF1", quantity: "5", unit: "head" }],
    });
    const definition = new AgreementDefinition(definitionData, {
      callEndpoint,
    });

    await expect(
      definition.runProcesses({
        location: { type: "page", state: "offered", page: "offered" },
        context: { agreement: { state: "offered" }, execution },
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

  it("checks page access before running a Process", async () => {
    const definitionData = createDefinition();
    definitionData.pages.hidden = {
      title: "Hidden",
      components: [{ component: "heading", text: "Hidden" }],
      processes: ["calculate-offer"],
    };
    const callEndpoint = vi.fn();
    const definition = new AgreementDefinition(definitionData, {
      callEndpoint,
    });

    await expect(
      definition.runProcesses({
        location: { type: "page", state: "offered", page: "hidden" },
        context: { agreement: { state: "offered" }, execution },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 403 } });
    expect(callEndpoint).not.toHaveBeenCalled();
  });

  it("rejects values outside the location-specific context", async () => {
    const callEndpoint = vi.fn();
    const definition = new AgreementDefinition(createDefinition(), {
      callEndpoint,
    });

    await expect(
      definition.runProcesses({
        location: { type: "create" },
        context: {
          agreement: { state: "accepted" },
          application: { quantity: 5 },
          execution,
        },
      }),
    ).rejects.toMatchObject({ output: { statusCode: 500 } });
    expect(callEndpoint).not.toHaveBeenCalled();
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

  it("preserves deliberate Boom errors from handlers", async () => {
    const definitionData = createDefinition();
    definitionData.processDefinitions["create-agreement-payment"] = {
      type: "handler",
      input: paymentHandlerInput,
    };
    addTransition(definitionData, ["create-agreement-payment"]);
    const definition = new AgreementDefinition(definitionData);

    await expect(
      definition.runProcesses({
        location: {
          type: "transition",
          state: "offered",
          transition: "accept",
        },
        context: {
          agreement: { state: "offered" },
          transition: { values: {} },
          execution,
        },
      }),
    ).rejects.toMatchObject({
      message:
        'Agreement Process handler "create-agreement-payment" is not implemented',
      output: { statusCode: 500 },
    });
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
    /conflict between optional exclusive peers/i,
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
    "unknown handler input fields",
    () => {
      const definition = createDefinition();
      const input = structuredClone(paymentHandlerInput);
      input.agreementValues.agreementNumber = "not-configurable";
      definition.processDefinitions["create-agreement-payment"] = {
        type: "handler",
        input,
      };
      return { definition };
    },
    /agreementValues\.agreementNumber.*unknown/,
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
