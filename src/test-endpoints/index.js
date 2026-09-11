import { config } from "../common/config.js";
import { logger } from "../common/logger.js";
import { createTestAgreementRoute } from "./routes/create-test-agreement.route.js";
import { updateTestAgreementStatusRoute } from "./routes/update-test-agreement-status.route.js";

// FGP-1411: QA-only endpoints that let the agreement journey, accessibility and
// performance suites set up Agreements and drive status changes without the
// legacy Agreements API queue-message endpoint.
//
// The routes are not registered at all when the flag is off, so a request gets
// the same 404 as any unknown path and the endpoints cannot be reached in
// production even if something else is misconfigured.
export const testEndpoints = {
  name: "test-endpoints",
  register(server) {
    if (!config.enableTestEndpoints) {
      return;
    }

    logger.warn(
      "ENABLE_TEST_ENDPOINTS is true: /api/test routes are registered. These must never be enabled in production.",
    );

    server.route([createTestAgreementRoute, updateTestAgreementStatusRoute]);
  },
};
