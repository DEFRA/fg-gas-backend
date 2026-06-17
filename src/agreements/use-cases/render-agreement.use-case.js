import Boom from "@hapi/boom";
import { resolveJSONPath } from "../../common/resolve-json.js";
import { getAgreementDefinition as getConfiguredAgreementDefinition } from "../models/agreement-definition.js";
import { findAgreementWithLatestVersionByAgreementNumber } from "../repositories/agreement.repository.js";

const defaultDependencies = {
  getAgreementDefinition: getConfiguredAgreementDefinition,
};

const resolveDependencies = (dependencies) => ({
  ...defaultDependencies,
  ...dependencies,
});

export const renderAgreementUseCase = async (
  { agreementNumber, page },
  dependencies = {},
) => {
  const record =
    await findAgreementWithLatestVersionByAgreementNumber(agreementNumber);

  return renderAgreementRecord({ record, page }, dependencies);
};

export const renderAgreementRecord = async (
  { record, page },
  dependencies = {},
) => {
  const { getAgreementDefinition } = resolveDependencies(dependencies);

  assertRecordFound(record);
  assertVersionFound(record.version);

  return renderConfigBackedAgreement({
    agreement: record.agreement,
    getAgreementDefinition,
    page,
    version: record.version,
  });
};

const assertRecordFound = (record) => {
  if (!record) {
    throw Boom.notFound("Agreement not found");
  }
};

const assertVersionFound = (version) => {
  if (!version) {
    throw Boom.notFound("Agreement version not found");
  }
};

const assertPageFound = (pageConfig) => {
  if (!pageConfig) {
    throw Boom.notFound("Agreement page not found");
  }
};

const renderConfigBackedAgreement = async ({
  agreement,
  getAgreementDefinition,
  page,
  version,
}) => {
  const { definition, itemState } = findRenderableItem({
    agreementCode: getAgreementCode({ agreement, version }),
    getAgreementDefinition,
    items: version.snapshot.items,
  });
  const agreementModel = toAgreementModel({
    agreement,
    itemState,
  });
  const pageId = getPageId({ definition, itemState, page });
  const pageConfig = getPageConfig({ definition, pageId });
  assertPageFound(pageConfig);
  const root = {
    agreement,
    item: itemState,
    version,
  };

  return {
    source: "config",
    agreement: agreementModel,
    page: toRenderPageModel({ pageConfig, pageId }),
    components: await resolveJSONPath({
      root,
      path: pageConfig.components,
    }),
    actions: await resolveJSONPath({
      root,
      path: getActionsConfig(pageConfig),
    }),
  };
};

const getFirstItem = (items = []) => {
  const [item = {}] = items;
  return item;
};

const getSnapshotAgreementCode = (version) => {
  const item = getFirstItem(version.snapshot.items);
  return version.snapshot.code || item.agreementCode;
};

const getAgreementDocumentCode = (agreement) => {
  const item = getFirstItem(agreement.items);
  return item.document?.agreementCode;
};

const getAgreementCode = ({ agreement, version }) =>
  getSnapshotAgreementCode(version) ||
  agreement.code ||
  getAgreementDocumentCode(agreement);

const getPageId = ({ definition, itemState, page }) =>
  page || getDefaultPage({ definition, status: itemState.status });

const getActionsConfig = (pageConfig) => pageConfig.actions ?? [];

const toRenderPageModel = ({ pageConfig, pageId }) => {
  const pageModel = {
    id: pageId,
    title: pageConfig.title,
  };

  if (pageConfig.layout) {
    pageModel.layout = pageConfig.layout;
  }

  return pageModel;
};

const findRenderableItem = ({
  agreementCode,
  getAgreementDefinition,
  items = [],
}) => {
  const definition = getAgreementDefinition(agreementCode);

  if (!definition.pages) {
    throw Boom.notFound("Config-backed agreement item not found");
  }

  const [itemState] = items;

  if (!itemState) {
    throw Boom.notFound("Config-backed agreement item not found");
  }

  return { definition, itemState };
};

const toAgreementModel = ({ agreement, itemState }) => {
  return {
    agreementNumber: agreement.agreementNumber,
    code: agreement.code ?? itemState.agreementCode,
    clientRef: itemState.clientRef,
    status: itemState.status,
    identifiers: agreement.identifiers,
  };
};

const getDefaultPage = ({ status }) => status;

const getPageConfig = ({ definition, pageId }) => definition.pages[pageId];
