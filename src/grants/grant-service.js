import Boom from "@hapi/boom";
import { wreck } from "../common/wreck.js";
import { grantRepository } from "./grant-repository.js";
import { Grant } from "./grant.js";

export const grantService = {
  async create(props) {
    const grant = Grant.create(props);

    await grantRepository.add(grant);

    return grant;
  },

  async findAll() {
    return grantRepository.findAll();
  },

  async findByCode(code) {
    Grant.validateCode(code);

    const grant = await grantRepository.findByCode(code);

    if (grant === null) {
      throw Boom.notFound(`Grant with code "${code}" not found`);
    }

    return grant;
  },

  async invokeGetAction({ code, name }) {
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
  },

  async invokePostAction({ code, name, payload }) {
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
  },
};
