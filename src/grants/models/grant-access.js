import Boom from "@hapi/boom";
import { GrantSettings } from "./grant-settings.js";

export class GrantAccess {
  constructor({ settings, allowList }) {
    this.settings = settings ?? GrantSettings.closed(allowList.grantCode);
    if (this.settings.grantCode !== allowList.grantCode) {
      throw Boom.internal(
        "Grant settings and allow list must belong to the same grant",
      );
    }
    this.allowList = allowList;
  }

  allows(applicant) {
    return this.settings.isOpen() && this.allowList.allows(applicant);
  }

  allowsBusiness(business) {
    return this.settings.isOpen() && this.allowList.allowsBusiness(business);
  }
}
