import Boom from "@hapi/boom";
import { wreck } from "../common/wreck.js";
import * as grantRepository from "./grant-repository.js";
import * as applicationRepository from "./application-repository.js";
import { createGrant } from "./grant.js";
import { createApplication } from "./application.js";

import { config } from "../common/config.js";
import { publish } from "../common/sns.js";
import { getTraceId } from "@defra/hapi-tracing";

export const replace = async (props) => {
  const grant = createGrant(props);

  await grantRepository.replace(grant);

  return grant;
};

export const create = async (props) => {
  const grant = createGrant(props);

  await grantRepository.add(grant);

  return grant;
};

export const findAll = async () => {
  return grantRepository.findAll();
};

export const findByCode = async (code) => {
  const grant = await grantRepository.findByCode(code);

  if (grant === null) {
    throw Boom.notFound(`Grant with code "${code}" not found`);
  }

  return grant;
};

export const findApplicationByClientRef = async (clientRef) => {
  const application = await applicationRepository.findByClientRef(clientRef);

  if (application === null) {
    throw Boom.notFound(`Application with clientRef "${clientRef}" not found`);
  }

  return application;
};
export const invokeGetAction = async ({ code, name }) => {
  const grant = await grantRepository.findByCode(code);

  if (grant === null) {
    throw Boom.notFound(`Grant with code "${code}" not found`);
  }

  const action = grant.actions.find(
    (e) => e.method === "GET" && e.name === name,
  );

  if (!action) {
    throw Boom.badRequest(
      `Grant with code "${code}" has no GET action named "${name}"`,
    );
  }

  const response = await wreck.get(`${action.url}?code=${code}`, {
    json: true,
  });

  return response.payload;
};

export const invokePostAction = async ({ code, name, payload }) => {
  const grant = await grantRepository.findByCode(code);

  if (grant === null) {
    throw Boom.notFound(`Grant with code "${code}" not found`);
  }

  const action = grant.actions.find(
    (e) => e.method === "POST" && e.name === name,
  );

  if (!action) {
    throw Boom.badRequest(
      `Grant with code "${code}" has no POST action named "${name}"`,
    );
  }

  const response = await wreck.post(action.url, {
    payload,
    json: true,
  });

  return response.payload;
};

export const submitApplication = async (code, createApplicationRequest) => {
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

  await publish(config.grantApplicationCreatedTopic, application, getTraceId());
};
