import { collection as grantsCollection } from "../repositories/grant.repository.js";

export const grantsSource = {
  name: "grants",
  label: "Grant versions, in the Grant Application Service",
  service: "GAS",
  size: "small",
  requires: null,
  bucket: "gas.grants",
  time: "receivedAt",
  noun: { one: "grant version", many: "grant versions" },
  star: ["grantCode", "version", "status", "worstFetchStatus", "receivedAt"],
  answersAt: null,
  attach: [
    {
      as: "definition",
      collection: grantsCollection,
      on: [
        ["grantCode", "code"],
        ["version", "version"],
      ],
    },
  ],
  open: (doc) => ({ kind: "grant", code: doc.grantCode, version: doc.version }),
  openPaths: ["grantCode", "version"],
  paths: [
    { path: "_id", type: "objectId" },
    { path: "grantCode", type: "text", index: { fact: "grantCode" } },
    { path: "version", type: "text" },
    { path: "major", type: "number" },
    { path: "status", type: "text", index: { fact: "status" } },
    {
      path: "worstFetchStatus",
      type: "text",
      index: { fact: "worstFetchStatus" },
    },
    { path: "receivedAt", type: "date", index: { time: true } },
    { path: "definitions.grant.fetchStatus", type: "text" },
    { path: "definition.phases.code", type: "text" },
    { path: "definition.phases.stages.code", type: "text" },
  ],
};
