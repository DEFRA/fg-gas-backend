const matchesConfiguredValue = (actual, expected) =>
  Array.isArray(actual) ? actual.includes(expected) : actual === expected;

const toValidationError = ({ name, href, message }) => ({
  name,
  href,
  message,
});

const collectValidationErrors = (requirements, values) => {
  const errors = [];

  for (const requirement of requirements) {
    const { name, value } = requirement;

    if (!matchesConfiguredValue(values[name], value)) {
      errors.push(toValidationError(requirement));
    }
  }

  return errors;
};

export class AgreementAction {
  #from;
  #name;
  #target;
  #validation;

  constructor({ from, name, target, validation }) {
    this.#from = from;
    this.#name = name;
    this.#target = target;
    this.#validation = validation;
  }

  get transition() {
    return {
      from: this.#from,
      action: this.#name,
      target: this.#target,
    };
  }

  validate(values) {
    const requirements = this.#validation?.required;

    if (!requirements) {
      return { valid: true };
    }

    const errors = collectValidationErrors(requirements, values);

    if (errors.length === 0) {
      return { valid: true };
    }

    return {
      valid: false,
      page: this.#validation.page,
      errors,
    };
  }
}
