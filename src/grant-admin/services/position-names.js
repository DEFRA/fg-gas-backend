const codeAndName = ({ code, name }) => ({ code, name: name ?? null });

const nameOf = (items, code) =>
  items?.find((item) => item.code === code)?.name ?? null;

// Where a record is, as its definition names it: every phase in order, and
// the record's own stage and status. A code the definition lacks has no name.
export const namePosition = (phases, { phase, stage, status }) => {
  const stages = phases.find(({ code }) => code === phase)?.stages;
  const statuses = stages?.find(({ code }) => code === stage)?.statuses;

  return {
    phases: phases.map(codeAndName),
    stage: nameOf(stages, stage),
    status: nameOf(statuses, status),
  };
};
