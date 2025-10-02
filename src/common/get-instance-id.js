import os from "node:os";

export const getInstanceId = () => {
  return os.hostname();
}