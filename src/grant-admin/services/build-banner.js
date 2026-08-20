import { toApplicationContext } from "./application-context.js";

// A field an application has no value for is left out rather than shown empty.
const field = (label, text, type = "string") =>
  text == null ? undefined : { label, text, type };

const withoutEmpty = (summary) =>
  Object.fromEntries(
    Object.entries(summary).filter(([, entry]) => entry !== undefined),
  );

const businessName = (answers) => answers.applicant?.business?.name;

const withTitle = (name) =>
  name ? { title: { text: name, type: "string" } } : {};

/**
 * The header the claims page is topped with.
 *
 * These fields are the ones the story asks for, chosen here rather than by the
 * grant. A following change moves that choice into the grant definition, so a
 * scheme can say what its own header shows. This stands in until then, and it
 * answers with the shape config will produce afterwards, so the frontend does
 * not change when the source does.
 */
export const buildBanner = ({ grant, application }) => {
  const { clientRef, identifiers, answers } = toApplicationContext(application);

  return {
    ...withTitle(businessName(answers)),
    summary: withoutEmpty({
      scheme: field("Scheme", grant.metadata?.description),
      applicationId: field("Application ID", clientRef),
      sbi: field("SBI", identifiers.sbi),
    }),
  };
};
