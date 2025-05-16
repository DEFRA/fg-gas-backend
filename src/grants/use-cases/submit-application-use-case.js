import Boom from "@hapi/boom";
import { createApplication } from "../application.js";
import * as grantRepository from "../grant-repository.js";
import * as applicationRepository from "../application-repository.js";
import { config } from "../../common/config.js";
import { publish } from "../../../common/sns.js";

export const submitApplicationUseCase = async (
  code,
  createApplicationRequest,
) => {
  const grant = await grantRepository.findByCode(code);

  if (grant === null) {
    throw Boom.notFound(`Grant with code "${code}" not found`);
  }

  const application = createApplication(
    code,
    grant.questions,
    createApplicationRequest,
  );

  await applicationRepository.add(application);

  await publish(config.grantApplicationCreatedTopic, application);
};
