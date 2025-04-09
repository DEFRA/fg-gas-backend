import Boom from "@hapi/boom";
import { wreck } from "../common/wreck.js";
import * as grantRepository from "./grant-repository.js";
import * as applicationRepository from "./application-repository.js";
import * as Grant from "./grant.js";
import { createApplication } from "./application.js";

export const create = async (props) => {
  const grant = Grant.create(props);

  await grantRepository.add(grant);

  return grant;
};

export const findAll = async () => {
  return grantRepository.findAll();
};

export const findByCode = async (code) => {
  Grant.validateCode(code);

  const grant = await grantRepository.findByCode(code);

  if (grant === null) {
    throw Boom.notFound(`Grant with code "${code}" not found`);
  }

  return grant;
};

export const invokeGetAction = async ({ code, name }) => {
  Grant.validateCode(code);
  Grant.validateActionName(name);

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
  Grant.validateCode(code);
  Grant.validateActionName(name);
  Grant.validateActionPayload(payload);

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
  Grant.validateCode(code);

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
};
