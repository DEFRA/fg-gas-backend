import Boom from "@hapi/boom";
import { resolveAgreementIdentitySequence } from "./agreement-identity-sequence.js";

export class AgreementIdentityAllocation {
  #type;
  #nextOrdinal;
  #existingIds;

  constructor(type, nextOrdinal, existingIds = new Set()) {
    this.#type = type;
    this.#nextOrdinal = nextOrdinal;
    this.#existingIds = existingIds;
  }

  static forCreation(type) {
    return new AgreementIdentityAllocation(type, 1);
  }

  static forTransition(agreement, type) {
    const existingIds = new Set(
      type.currentEntriesOf(agreement).map(({ id }) => id),
    );

    return new AgreementIdentityAllocation(
      type,
      resolveAgreementIdentitySequence(agreement)[type.namespace] + 1,
      existingIds,
    );
  }

  allocate() {
    const id = this.#type.idFor(this.#nextOrdinal);
    this.#nextOrdinal += 1;
    return id;
  }

  resolve(candidate) {
    return candidate.id ? this.#requireExisting(candidate.id) : this.allocate();
  }

  #requireExisting(id) {
    if (!this.#existingIds.has(id)) {
      throw Boom.badImplementation(
        `Agreement transition cannot select unknown stable ${this.#type.label} identity "${id}"`,
      );
    }

    return id;
  }
}
