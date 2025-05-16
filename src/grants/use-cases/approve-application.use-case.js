import { publishApplicationApproved } from "../publishers/application-event.publisher.js";
import { findApplicationByClientRefUseCase } from "./find-application-by-client-ref.use-case.js";

export const approveApplicationUseCase = async (clientRef) => {
  const application = await findApplicationByClientRefUseCase(clientRef);

  await publishApplicationApproved(application);
};
