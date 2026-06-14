import { randomUUID } from "node:crypto";
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

export { agreementCreationOutcomes };

const maxCreateAttempts = 5;

const defaultDependencies = {
  createId: randomUUID,
  generateAgreementNumber: (creation) =>
    generateConfiguredAgreementNumber({
      config: creation.agreementNumber,
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

const buildInitialVersion = ({ agreement, creation, createId, createdAt }) =>
  agreement.createInitialVersion({
    versionId: createId(),
    initialVersion: creation.initialVersion,
    createdAt,
  });

const createNewAgreementAttempt = async ({
  command,
  creation,
  createId,
  generateAgreementNumber,
  now,
  session,
}) => {
  const createdAt = now();
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
  creation,
  createId,
  generateAgreementNumber,
  now,
  session,
}) =>
  retryCreate({
    create: () =>
      createNewAgreementAttempt({
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
  const { createId, generateAgreementNumber, getAgreementCreation, now } =
    resolveDependencies(dependencies);
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
    command,
    creation,
    createId,
    generateAgreementNumber: generateNumber,
    now,
    session,
  });
};
