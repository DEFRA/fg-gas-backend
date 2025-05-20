import { publishApplicationApproved } from "../publishers/application-event-publisher.js";
import * as applicationRepository from "../repositories/application-repository.js";

export const approveApplicationUseCase = async (clientRef) => {
  const application = await applicationRepository.findByClientRef(clientRef);

  if (application === null) {
    throw new Error(`Application with clientRef "${clientRef}" not found`);
  }

  await publishApplicationApproved(application);
};
