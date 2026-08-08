import Boom from "@hapi/boom";
import { AgreementLifecycle } from "../agreement-lifecycle.js";
import { generateAgreementNumber } from "../agreement-number.js";
import { requirePersistedAgreementState } from "../require-persisted-agreement-state.js";
import { compileAgreementCreation } from "./compile-agreement-creation.js";
import { compileTransitionValueMappings } from "./compile-transition-value-mapping.js";
import { compileAgreementProcesses } from "./processes/agreement-process-runtime.js";
import { validateAgreementDefinition } from "./validate.js";

export class AgreementDefinition {
  #createAgreement;
  #definition;
  #runProcesses;

  constructor(definition, dependencies = {}) {
    this.#definition = validateAgreementDefinition(definition);
    const {
      generateAgreementNumber:
        agreementNumberGenerator = generateAgreementNumber,
      ...processDependencies
    } = dependencies;
    const resolveTransitionValues = compileTransitionValueMappings(
      this.#definition,
    );
    this.#runProcesses = compileAgreementProcesses(
      this.#definition,
      processDependencies,
      resolveTransitionValues,
    );
    this.#createAgreement = compileAgreementCreation(this.#definition, {
      generateAgreementNumber: agreementNumberGenerator,
      runProcesses: this.#runProcesses,
    });
  }

  async createAgreement(options) {
    return this.#createAgreement(options);
  }

  getEndpoints() {
    return structuredClone(this.#definition.endpoints ?? []);
  }

  getTemplates() {
    return structuredClone(this.#definition.templates ?? {});
  }

  async runProcesses(options) {
    if (options.location?.type === "create") {
      throw Boom.badImplementation(
        "Agreement creation Processes are private to Agreement creation",
      );
    }

    return this.#runProcesses(options);
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
