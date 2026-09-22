import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTraceParent } from "../../common/trace-parent.js";
import { processConfigVersionUseCase } from "../use-cases/process-config-version.use-case.js";
import { handleConfigVersionMessage } from "./handle-config-version-message.js";

vi.mock("../../common/trace-parent.js");
vi.mock("../use-cases/process-config-version.use-case.js");

describe("handleConfigVersionMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withTraceParent.mockImplementation((_, handler) => handler());
  });

  it("applies the Config Broker version under the stored trace", async () => {
    await handleConfigVersionMessage({
      traceparent: "00-abc-def-01",
      event: {
        data: {
          grantCode: "woodland",
          version: "1.2.0",
          status: "active",
          s3Bucket: "config-broker-bucket",
          manifest: ["woodland/1.2.0/gas/gas.json"],
        },
      },
    });

    expect(withTraceParent).toHaveBeenCalledWith(
      "00-abc-def-01",
      expect.any(Function),
    );
    expect(processConfigVersionUseCase).toHaveBeenCalledWith({
      grantCode: "woodland",
      version: "1.2.0",
      status: "active",
      s3Bucket: "config-broker-bucket",
      manifest: ["woodland/1.2.0/gas/gas.json"],
    });
  });
});
