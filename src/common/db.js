import tls from "node:tls";
import { MongoClient } from "mongodb";
import { config } from "./config.js";

export const mongoClient = new MongoClient(config.MONGO_URI, {
  retryWrites: false,
  readPreference: "secondary",
  secureContext: tls.createSecureContext(),
});

export const db = mongoClient.db(config.MONGO_DATABASE);
