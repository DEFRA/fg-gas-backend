export class GrantDocument {
  constructor(grant) {
    this.code = grant.code;
    this.version = grant.version;
    this.metadata = grant.metadata;
    this.actions = grant.actions;
    this.phases = grant.phases;
    this.externalStatusMap = grant.externalStatusMap;
    this.amendablePositions = grant.amendablePositions;
  }
}
