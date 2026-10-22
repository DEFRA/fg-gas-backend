import Boom from "@hapi/boom";

const toInstantString = (value) => {
  const instant = new Date(value);

  if (Number.isNaN(instant.getTime())) {
    throw Boom.badImplementation(
      `Grant start date "${value}" is not an instant`,
    );
  }

  return instant.toISOString();
};

// The start date is stored as an ISO string. A published definition may write
// it as Mongo extended JSON, which arrives as a literal { $date } object.
const toStoredStartDate = (startDate) => {
  if (startDate instanceof Date) {
    return startDate.toISOString();
  }

  return startDate?.$date === undefined
    ? startDate
    : toInstantString(startDate.$date);
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
