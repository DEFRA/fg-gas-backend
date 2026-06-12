import { randomUUID } from "node:crypto";
import {
  agreementCreationOutcomes,
  alreadyCreatedAgreementResult,
  createdAgreementResult,
} from "../models/agreement-creation-result.js";
import {
  agreementImplementations,
  getAgreementDefinition,
} from "../models/agreement-definition.js";
import { generateAgreementNumber as generateConfiguredAgreementNumber } from "../models/agreement-number.js";
import { Agreement } from "../models/agreement.js";
import {
  findAgreementBySourceIdentity,
  insertAgreementWithVersion,
  isAgreementNumberCollision,
  isSourceIdentityCollision,
} from "../repositories/agreement.repository.js";

export { agreementCreationOutcomes };

const maxCreateAttempts = 5;

const defaultDependencies = {
  createId: randomUUID,
  generateAgreementNumber: (definition) =>
    generateConfiguredAgreementNumber({
      config: definition.agreementNumber,
    }),
  now: () => new Date().toISOString(),
};

const resolveDependencies = (dependencies) => ({
  ...defaultDependencies,
  ...dependencies,
});

const assertConfigBacked = ({ command, definition }) => {
  if (definition.implementation === agreementImplementations.CONFIG) {
    return;
  }

  throw new Error(`Agreement definition ${command.code} is not config-backed`);
};

const getSourceIdentity = ({ command, definition }) => ({
  agreementCode: definition.agreementCode,
  clientRef: command.clientRef,
});

const findExistingAgreement = async ({ command, definition, session }) => {
  const agreement = await findAgreementBySourceIdentity(
    getSourceIdentity({ command, definition }),
    session,
  );
  const item = agreement?.findItemForCommand({ command, definition });

  return item ? alreadyCreatedAgreementResult({ agreement, item }) : null;
};

const createAgreementValues = ({ createId, generateAgreementNumber }) => ({
  agreementId: createId(),
  agreementNumber: generateAgreementNumber(),
  agreementItemId: createId(),
});

const buildNewAgreement = ({
  command,
  definition,
  createId,
  generateAgreementNumber,
  createdAt,
}) =>
  Agreement.createFromCommand({
    command,
    definition,
    now: createdAt,
    ...createAgreementValues({ createId, generateAgreementNumber }),
  });

const buildInitialVersion = ({ agreement, definition, createId, createdAt }) =>
  agreement.createInitialVersion({
    versionId: createId(),
    definition,
    createdAt,
  });

const createNewAgreementAttempt = async ({
  command,
  definition,
  createId,
  generateAgreementNumber,
  now,
  session,
}) => {
  const createdAt = now();
  const agreement = buildNewAgreement({
    command,
    definition,
    createId,
    generateAgreementNumber,
    createdAt,
  });
  const item = agreement.findItemForCommand({ command, definition });
  const version = buildInitialVersion({
    agreement,
    definition,
    createId,
    createdAt,
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
  command,
  definition,
  createId,
  generateAgreementNumber,
  now,
  session,
}) =>
  retryCreate({
    create: () =>
      createNewAgreementAttempt({
        command,
        definition,
        createId,
        generateAgreementNumber,
        now,
        session,
      }),
    onCollision: () => findExistingAgreement({ command, definition, session }),
  });

export const createAgreement = async (command, session, dependencies = {}) => {
  const { createId, generateAgreementNumber, now } =
    resolveDependencies(dependencies);
  const definition = getAgreementDefinition(command.code);
  assertConfigBacked({ command, definition });

  const existingAgreement = await findExistingAgreement({
    command,
    definition,
    session,
  });

  if (existingAgreement) {
    return existingAgreement;
  }

  const generateNumber = () => generateAgreementNumber(definition);

  return createNewOrExistingAgreement({
    command,
    definition,
    createId,
    generateAgreementNumber: generateNumber,
    now,
    session,
  });
};
