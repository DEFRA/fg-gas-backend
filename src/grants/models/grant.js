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

export class Grant {
  constructor(props) {
    this.code = props.code;
    this.metadata = {
      description: props.metadata.description,
      startDate: props.metadata.startDate,
    };
    this.actions = props.actions.map((e) => ({
      name: e.name,
      method: e.method,
      url: e.url,
    }));
    this.questions = props.questions;
  }
}
