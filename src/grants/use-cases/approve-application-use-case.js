import { publishApplicationApproved } from "../publishers/application-event-publisher.js";
import { findByClientRef } from "../repositories/application-repository.js";

export const approveApplicationUseCase = async (clientRef) => {
  const application = await findByClientRef(clientRef);

  if (application === null) {
    throw new Error(`Application with clientRef "${clientRef}" not found`);
  }

  await publishApplicationApproved(application);
};
