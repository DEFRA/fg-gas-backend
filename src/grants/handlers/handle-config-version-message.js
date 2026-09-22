import { withTraceParent } from "../../common/trace-parent.js";
import { processConfigVersionUseCase } from "../use-cases/process-config-version.use-case.js";

export const handleConfigVersionMessage = async ({ event, traceparent }) => {
  const { data } = event;

  await withTraceParent(traceparent, async () =>
    processConfigVersionUseCase({
      grantCode: data.grantCode,
      version: data.version,
      status: data.status,
      manifest: data.manifest,
      s3Bucket: data.s3Bucket,
    }),
  );
};
