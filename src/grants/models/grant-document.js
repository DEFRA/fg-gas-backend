import Boom from "@hapi/boom";
import { startDate as instant } from "../schemas/grant/metadata/start-date.js";

const assertInstant = (value) => {
  const { error, value: date } = instant.validate(value);

  if (error) {
    throw Boom.badImplementation(
      `Grant start date "${value}" is not an instant`,
    );
  }

  return date;
};

// The start date is stored as an ISO string. A published definition may write
// it as Mongo extended JSON, which arrives as a literal { $date } object.
const toStoredStartDate = (startDate) => {
  if (startDate?.$date !== undefined) {
    return assertInstant(startDate.$date).toISOString();
  }

  if (typeof startDate === "string") {
    assertInstant(startDate);
    return startDate;
  }

  return assertInstant(startDate).toISOString();
};

export class GrantDocument {
  constructor(grant) {
    this.code = grant.code;
    this.version = grant.version;
    this.metadata = {
      ...grant.metadata,
      startDate: toStoredStartDate(grant.metadata.startDate),
    };
    this.actions = grant.actions;
    this.phases = grant.phases;
    this.externalStatusMap = grant.externalStatusMap;
    this.amendablePositions = grant.amendablePositions;
    this.entitlementTemplates = grant.entitlementTemplates;
    this.pages = grant.pages;
    this.claims = grant.claims;
    this.admin = grant.admin;
  }
}
