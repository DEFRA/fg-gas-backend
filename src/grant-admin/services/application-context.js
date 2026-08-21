// What a banner's references are resolved against. Deliberately flat and
// deliberately close to the case working shape ("$.payload.answers.…" there,
// "$.answers.…" here), so someone maintaining a grant's two configs is not
// translating between them.
//
// Answers are merged across every phase rather than taken from the current one:
// woodland declares the applicant in PHASE_PRE_AWARD only, and this page exists
// for applications that have moved on to claiming. Later phases win, so an
// answer restated as an application progresses is read at its newest value.
const mergeAnswers = (phases = []) =>
  phases.reduce(
    (merged, phase) => ({ ...merged, ...(phase.answers ?? {}) }),
    {},
  );

export const toApplicationContext = (application) => ({
  clientRef: application.clientRef,
  code: application.code,
  phase: application.currentPhase,
  stage: application.currentStage,
  status: application.currentStatus,
  identifiers: application.identifiers ?? {},
  answers: mergeAnswers(application.phases),
});
