import os from "node:os";

export const getInstanceId = () => {
  return os.hostname();
};

export const getSelfInstanceId = async () => {
  return os.hostname();
};
