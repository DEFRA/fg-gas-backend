import { Position } from "./position.js";

const codeAndName = ({ code, name }) => ({ code, name: name ?? null });

export const describePhases = (phases) =>
  phases.map((phase) => ({
    ...codeAndName(phase),
    stages: phase.stages.map((stage) => ({
      ...codeAndName(stage),
      statuses: stage.statuses.map(codeAndName),
    })),
  }));

export const distinctPositions = (phases) => {
  const positions = phases.flatMap((phase) =>
    phase.stages.flatMap((stage) =>
      stage.statuses.map(
        (status) =>
          new Position({
            phase: phase.code,
            stage: stage.code,
            status: status.code,
          }),
      ),
    ),
  );

  return [
    ...new Map(
      positions.map((position) => [position.toString(), position]),
    ).values(),
  ];
};
