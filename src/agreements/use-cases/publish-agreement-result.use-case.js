import {
  existsByEventId,
  insertMany,
} from "../../grants/repositories/outbox.repository.js";
import { createAgreementPublicationOutboxRecords } from "./create-agreement-publication-outbox-records.use-case.js";

const hasPublication = (publication) =>
  Boolean(publication?.lifecycleEvent || publication?.paymentClaim);

export const publishAgreementPublication = async (
  { agreement, item, publication, version },
  session,
) => {
  if (!hasPublication(publication)) {
    return;
  }

  if (
    publication.lifecycleEvent &&
    (await existsByEventId(version.id, session))
  ) {
    return;
  }

  await insertMany(
    createAgreementPublicationOutboxRecords({
      agreement,
      item,
      publication,
      version,
    }),
    session,
  );
};

export const publishAgreementResult = async (result, session) => {
  if (!result.version) {
    return;
  }

  await publishAgreementPublication(
    {
      agreement: result.agreement,
      item: result.item,
      publication: result.publication,
      version: result.version,
    },
    session,
  );
};
