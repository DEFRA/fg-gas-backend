import Boom from "@hapi/boom";
import { AgreementItem } from "../agreement-item.js";
import { AgreementLifecycle } from "../agreement-lifecycle.js";
import { generateAgreementNumber } from "../agreement-number.js";
import { Agreement } from "../agreement.js";
import { requirePersistedAgreementState } from "../require-persisted-agreement-state.js";
import { validateAgreementDefinition } from "./validate.js";

export class AgreementDefinition {
  #definition;

  constructor(definition) {
    this.#definition = validateAgreementDefinition(definition);
  }

  createAgreement({ clientRef, identifiers, payload, sourceSystem }) {
    const item = AgreementItem.create({
      agreementCode: this.#definition.code,
      clientRef,
      sourceSystem,
      configVersion: this.#definition.configVersion,
      identifiers,
      payload,
      state: this.#definition.create.target,
    });

    return Agreement.new({
      agreementNumber: generateAgreementNumber({
        prefix: this.#definition.agreementNumberPrefix,
      }),
      code: this.#definition.code,
      identifiers,
      items: [item],
    });
  }

  getCreationEffects() {
    return structuredClone(this.#definition.create.effects ?? []);
  }

  getEndpoints() {
    return structuredClone(this.#definition.endpoints ?? []);
  }

  resolveAction({ state, action }) {
    return new AgreementLifecycle(this.#definition).resolveAction(
      state,
      action,
    );
  }

  resolvePage(page) {
    const pageDefinition = this.#definition.pages[page];

    if (!pageDefinition) {
      throw Boom.notFound(
        `Unknown page "${page}" for agreement code "${this.#definition.code}"`,
      );
    }

    return structuredClone(pageDefinition);
  }

  resolvePageForState(state) {
    const stateDefinition = requirePersistedAgreementState({
      definition: this.#definition,
      state,
    });
    const pageId = stateDefinition.page;

    if (!pageId || !this.#definition.pages[pageId]) {
      throw Boom.badImplementation(
        `Agreement code "${this.#definition.code}" state "${state}" has no configured page`,
      );
    }

    return { pageId };
  }

  assertPageAllowed({ page, state }) {
    const stateDefinition = this.#definition.states[state];

    if (!stateDefinition) {
      throw Boom.notFound(
        `Unknown state "${state}" for agreement code "${this.#definition.code}"`,
      );
    }

    if (!collectAllowedPages(stateDefinition).has(page)) {
      throw Boom.forbidden(
        `Page "${page}" is not valid for agreement code "${this.#definition.code}" in state "${state}"`,
      );
    }
  }
}

const collectAllowedPages = (stateDefinition) =>
  new Set(
    [
      stateDefinition.page,
      ...Object.values(stateDefinition.on ?? {}).map(
        (action) => action.validation?.page,
      ),
    ].filter(Boolean),
  );
