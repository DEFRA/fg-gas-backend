import os from "node:os";
import { ECSClient, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { wreck } from "@hapi/wreck";
import { logger } from "./logger.js";

const ecs = new ECSClient({});

export const getInstanceId = () => {
  return os.hostname();
}

export const getSelfInstanceId = async () => {
  const metaUri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (!metaUri) {
    logger.warn("Not on ECS/Fargate (no ECS_CONTAINER_METADATA_URI_V4)");
    return os.hostname();
  }

  const meta = await wreck.get(`${metaUri}/task`, { json: true, });

  return {
    clusterArn: meta.Cluster,
    taskArn: meta.TaskARN,
    serviceName: process.env.ECS_SERVICE_NAME || null // optional to set in task env
  };
};

export const isTaskRunning = async (clusterArn, taskArn) =>  {
  const command = new DescribeTasksCommand({ cluster: clusterArn, tasks: [taskArn] });
  const { tasks, failures } = await ecs.send(command);

  console.log({failures});

  if (!tasks || tasks.length === 0) return false;
  
  const t = tasks[0];
  return t.lastStatus === "RUNNING";
}
