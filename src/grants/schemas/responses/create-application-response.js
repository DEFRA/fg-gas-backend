import Joi from "joi";
import { clientRef } from "../application/metadata/client-ref.js";

export const createApplicationResponse = Joi.object({
  clientRef,
}).label("CreateApplicationResponse");
