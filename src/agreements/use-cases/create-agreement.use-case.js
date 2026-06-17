import { randomUUID } from "node:crypto";
import { resolveJSONPath } from "../../common/resolve-json.js";
import {
  agreementCreationOutcomes,
  alreadyCreatedAgreementResult,
  createdAgreementResult,
} from "../models/agreement-creation-result.js";
import {
  getAgreementCreation as getConfiguredAgreementCreation,
  isConfigBackedAgreement,
} from "../models/agreement-definition-resolver.js";
import { generateAgreementNumber as generateConfiguredAgreementNumber } from "../models/agreement-number.js";
import { Agreement } from "../models/agreement.js";
import {
  findAgreementBySourceIdentity,
  insertAgreementWithVersion,
  isAgreementNumberCollision,
  isSourceIdentityCollision,
} from "../repositories/agreement.repository.js";
import { callAgreementEndpoint } from "../services/agreement-endpoint-client.js";

export { agreementCreationOutcomes };

const maxCreateAttempts = 5;

const defaultDependencies = {
  callEndpoint: callAgreementEndpoint,
  createId: randomUUID,
  generateAgreementNumber: (creation) =>
    generateConfiguredAgreementNumber({
      prefix: creation.agreementNumberPrefix,
    }),
  getAgreementCreation: getConfiguredAgreementCreation,
  now: () => new Date().toISOString(),
};

const resolveDependencies = (dependencies) => ({
  ...defaultDependencies,
  ...dependencies,
});

const assertConfigBacked = ({ command, creation }) => {
  if (isConfigBackedAgreement(creation)) {
    return;
  }

  throw new Error(`Agreement definition ${command.code} is not config-backed`);
};

const getSourceIdentity = ({ command, creation }) => ({
  agreementCode: creation.agreementCode,
  clientRef: command.clientRef,
});

const findExistingAgreement = async ({ command, creation, session }) => {
  const agreement = await findAgreementBySourceIdentity(
    getSourceIdentity({ command, creation }),
    session,
  );
  const item = agreement?.findItemForCommand({
    command,
    definition: creation,
  });

  return item ? alreadyCreatedAgreementResult({ agreement, item }) : null;
};

const createAgreementValues = ({ createId, generateAgreementNumber }) => ({
  agreementId: createId(),
  agreementNumber: generateAgreementNumber(),
  agreementItemId: createId(),
});

const buildNewAgreement = ({
  command,
  creation,
  createId,
  generateAgreementNumber,
  createdAt,
}) =>
  Agreement.createFromCommand({
    command,
    definition: creation,
    now: createdAt,
    ...createAgreementValues({ createId, generateAgreementNumber }),
  });

const buildEndpointParams = ({ command, effect }) =>
  resolveJSONPath({
    root: command,
    path: effect.params.endpoint.endpointParams,
  });

const isEndpointRef = (value) =>
  typeof value === "string" &&
  (value.startsWith("$.") || value.startsWith("jsonata:"));

const mergeEndpointInputChecks = (checks) => {
  const hasRefs = checks.some((check) => check.hasRefs);

  return {
    hasData: checks.some(
      (check) => check.hasData && (!hasRefs || check.hasRefs),
    ),
    hasRefs,
  };
};

const inspectEndpointInput = async ({ root, path }) => {
  if (Array.isArray(path)) {
    return mergeEndpointInputChecks(
      await Promise.all(
        path.map((item) => inspectEndpointInput({ root, path: item })),
      ),
    );
  }

  if (isRequestObject(path)) {
    return mergeEndpointInputChecks(
      await Promise.all(
        Object.values(path).map((value) =>
          inspectEndpointInput({ root, path: value }),
        ),
      ),
    );
  }

  if (isEndpointRef(path)) {
    return {
      hasData: hasRequestData(await resolveJSONPath({ root, path })),
      hasRefs: true,
    };
  }

  return { hasData: isPresentRequestValue(path), hasRefs: false };
};

const hasEndpointInputData = async ({ command, endpointParams }) => {
  if (endpointParams === undefined) {
    return true;
  }

  const check = await inspectEndpointInput({
    root: command,
    path: endpointParams,
  });
  return check.hasRefs ? check.hasData : hasRequestData(endpointParams);
};

const isPresentRequestValue = (value) =>
  value !== undefined && value !== null && value !== "";

const isRequestObject = (value) => value && typeof value === "object";

const hasRequestData = (value) => {
  if (Array.isArray(value)) {
    return value.length > 0 && value.some(hasRequestData);
  }

  if (isRequestObject(value)) {
    return Object.values(value).some(hasRequestData);
  }

  return isPresentRequestValue(value);
};

const callEndpointEffect = async ({ callEndpoint, command, effect }) => {
  if (
    !(await hasEndpointInputData({
      command,
      endpointParams: effect.params.endpoint.endpointParams,
    }))
  ) {
    return undefined;
  }

  return callEndpoint({
    endpoint: effect.params.endpoint,
    params: await buildEndpointParams({ command, effect }),
  });
};

const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const mergeDefined = (target = {}, patch = {}) =>
  Object.entries(patch).reduce((merged, [key, value]) => {
    if (value === undefined) {
      return merged;
    }

    if (isObject(value) && isObject(merged[key])) {
      return {
        ...merged,
        [key]: mergeDefined(merged[key], value),
      };
    }

    return {
      ...merged,
      [key]: value,
    };
  }, target);

const createSnapshotPatch = ({ context, effect }) =>
  resolveJSONPath({
    root: context,
    path: effect.params,
  });

const createEffectHandlers = {
  callEndpoint: callEndpointEffect,
  snapshot: createSnapshotPatch,
};

const runCreateEffect = async ({ callEndpoint, command, context, effect }) => {
  const handler = createEffectHandlers[effect.name];

  if (!handler) {
    return { command, context };
  }

  const output = await handler({ callEndpoint, command, context, effect });
  const nextContext = effect.output
    ? {
        ...context,
        outputs: {
          ...context.outputs,
          [effect.output]: output,
        },
      }
    : context;

  return {
    command,
    context:
      effect.name === "snapshot"
        ? {
            ...nextContext,
            itemPatch: mergeDefined(nextContext.itemPatch, output),
          }
        : nextContext,
  };
};

const runCreateEffects = async ({
  callEndpoint,
  command,
  creation,
  createdAt,
}) => {
  let currentContext = {
    command,
    createdAt,
    itemPatch: {},
    outputs: {},
  };

  for (const effect of creation.create?.effects ?? []) {
    const result = await runCreateEffect({
      callEndpoint,
      command,
      context: currentContext,
      effect,
    });

    currentContext = result.context;
  }

  return currentContext.itemPatch;
};

const buildInitialVersion = ({
  agreement,
  creation,
  createId,
  createdAt,
  itemPatch,
}) =>
  agreement.createInitialVersion({
    versionId: createId(),
    initialStatus: creation.initialStatus,
    createdAt,
    itemPatch,
  });

const createNewAgreementAttempt = async ({
  callEndpoint,
  command,
  creation,
  createId,
  generateAgreementNumber,
  now,
  session,
}) => {
  const createdAt = now();
  const itemPatch = await runCreateEffects({
    callEndpoint,
    command,
    creation,
    createdAt,
  });
  const agreement = buildNewAgreement({
    command,
    creation,
    createId,
    generateAgreementNumber,
    createdAt,
  });
  const item = agreement.findItemForCommand({
    command,
    definition: creation,
  });
  const version = buildInitialVersion({
    agreement,
    creation,
    createId,
    createdAt,
    itemPatch,
  });
  await insertAgreementWithVersion({ agreement, version }, session);

  return createdAgreementResult({ agreement, item, version });
};

const recoverFromCollision = async ({ error, onCollision }) => {
  if (isAgreementNumberCollision(error) || isSourceIdentityCollision(error)) {
    return onCollision();
  }

  throw error;
};

const createOrRecover = async ({ create, onCollision }) => {
  try {
    return (await create()) ?? (await onCollision());
  } catch (error) {
    return recoverFromCollision({ error, onCollision });
  }
};

const throwUnableToCreate = () => {
  throw new Error("Unable to create unique Agreement number");
};

const retryCreate = async ({ create, onCollision }) => {
  for (let attempt = 0; attempt < maxCreateAttempts; attempt++) {
    const result = await createOrRecover({ create, onCollision });

    if (result) {
      return result;
    }
  }

  throwUnableToCreate();
};

const createNewOrExistingAgreement = async ({
  callEndpoint,
  command,
  creation,
  createId,
  generateAgreementNumber,
  now,
  session,
}) =>
  retryCreate({
    create: () =>
      createNewAgreementAttempt({
        callEndpoint,
        command,
        creation,
        createId,
        generateAgreementNumber,
        now,
        session,
      }),
    onCollision: () => findExistingAgreement({ command, creation, session }),
  });

export const createAgreement = async (command, session, dependencies = {}) => {
  const {
    callEndpoint,
    createId,
    generateAgreementNumber,
    getAgreementCreation,
    now,
  } = resolveDependencies(dependencies);
  const creation = getAgreementCreation(command.code);
  assertConfigBacked({ command, creation });

  const existingAgreement = await findExistingAgreement({
    command,
    creation,
    session,
  });

  if (existingAgreement) {
    return existingAgreement;
  }

  const generateNumber = () => generateAgreementNumber(creation);

  return createNewOrExistingAgreement({
    callEndpoint,
    command,
    creation,
    createId,
    generateAgreementNumber: generateNumber,
    now,
    session,
  });
};
