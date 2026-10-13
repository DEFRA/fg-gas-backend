const fieldDetails = {
  sbi: {
    name: "SBI",
    label: "Single Business Identifiers (SBIs)",
    length: 9,
  },
  crn: {
    name: "CRN",
    label: "Customer Reference Numbers (CRNs)",
    length: 10,
  },
};

const fieldKeys = ["sbi", "crn"];

const parsedLinesIn = (value) =>
  value
    .split(/\r\n|\r|\n/)
    .map((line, index) => ({ value: line.trim(), number: index + 1 }))
    .filter(({ value: line }) => Boolean(line));

const linesIn = (value) => parsedLinesIn(value).map(({ value: line }) => line);

// Splitting the submitted text into lines is presentation, not validation -
// it always succeeds.
export const parseAllowListForm = (form) => {
  const lines = {
    sbi: parsedLinesIn(form.sbi),
    crn: parsedLinesIn(form.crn),
  };

  return {
    global: {
      sbi: lines.sbi.map(({ value }) => value),
      crn: lines.crn.map(({ value }) => value),
    },
    lines,
  };
};

const errorsFor = (key, lines, problems) => {
  const { name, length } = fieldDetails[key];
  const invalid = new Set(problems.invalid);
  const duplicate = new Set(problems.duplicate);
  const firstLineFor = new Map();

  return lines.flatMap((line) => {
    const errors = [];

    if (invalid.has(line.value)) {
      errors.push({
        key,
        line: line.number,
        message: `${name} "${line.value}" on line ${line.number} must be exactly ${length} digits`,
      });
    }

    const firstLine = firstLineFor.get(line.value);
    if (firstLine === undefined) {
      firstLineFor.set(line.value, line.number);
    } else if (duplicate.has(line.value)) {
      errors.push({
        key,
        line: line.number,
        message: `${name} "${line.value}" on line ${line.number} is a duplicate of line ${firstLine}`,
      });
    } else {
      // Seen before, but GAS didn't flag this value as a duplicate - nothing to report.
    }

    return errors;
  });
};

// Maps GAS's validation decision back onto the submitted lines; nothing here
// decides validity itself.
const toAllowListFieldErrors = ({ lines }, details) =>
  fieldKeys.flatMap((key) => errorsFor(key, lines[key], details[key]));

const countHint = (value) => {
  const count = linesIn(value).length;
  return `One per line. ${count} listed.`;
};

const messageFor = (errors, key) =>
  errors.find((error) => error.key === key)?.message;

const toField = (key, value, errors) => ({
  key,
  label: fieldDetails[key].label,
  value,
  hint: countHint(value),
  error: messageFor(errors, key),
});

const toAllowListForm = (allowList, submitted, errors = []) => {
  const values = submitted ?? {
    sbi: allowList.global.sbi.join("\n"),
    crn: allowList.global.crn.join("\n"),
  };

  return {
    sbi: toField("sbi", values.sbi, errors),
    crn: toField("crn", values.crn, errors),
  };
};

const toAllowListErrorSummary = (errors) =>
  errors.map(({ key, line, message }) => ({
    text: message,
    href: `#${key}`,
    attributes: { "data-error-line": line },
  }));

/**
 * The allow-list screen's view: form fields (label/value/hint/error) and an
 * error summary, built from the domain allow list and, on a refused save,
 * the submission and GAS's validation `details`. `submitted`/`details` are
 * both omitted for the plain view (GET) case.
 */
export const buildAllowListView = ({ allowList, submitted, details }) => {
  const errors = details
    ? toAllowListFieldErrors(parseAllowListForm(submitted), details)
    : [];

  return {
    ...toAllowListForm(allowList, submitted, errors),
    errorSummary: toAllowListErrorSummary(errors),
  };
};
