import Boom from "@hapi/boom";

const SUPPORTED_AGREEMENT_PAGE_MODES = new Set(["view"]);

export const assertSupportedAgreementPageMode = (mode) => {
  if (!SUPPORTED_AGREEMENT_PAGE_MODES.has(mode)) {
    throw Boom.notFound(`Unsupported mode "${mode}"`);
  }
};
