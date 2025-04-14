export const createGrant = (props) => {
  return {
    code: props.code,
    metadata: {
      description: props.metadata.description,
      startDate: props.metadata.startDate,
    },
    actions: props.actions.map((e) => ({
      name: e.name,
      method: e.method,
      url: e.url,
    })),
    questions: props.questions,
  };
};
