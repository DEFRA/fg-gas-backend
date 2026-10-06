import { findApplicationSummary } from "../../grants/services/application-read.service.js";
import { orNotFound } from "../services/application-not-found.js";

export const readApplicationSummary = async ({ clientRef, code }) =>
  orNotFound(await findApplicationSummary({ clientRef, code }));

export const readApplicationHeader = async ({ clientRef, code }) => {
  const { summary } = await readApplicationSummary({ clientRef, code });

  return {
    header: {
      clientRef: summary.clientRef,
      code: summary.code,
      position: summary.position,
      counterpart: null,
      fetchedAt: new Date().toISOString(),
    },
    accounts: summary.identifiers,
    sourceErrors: [],
  };
};
