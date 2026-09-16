import { config } from "../../common/config.js";

export const isGasManagedAgreementGrant = (code) =>
  !config.legacyAgreementGrantCodes.includes(code);
