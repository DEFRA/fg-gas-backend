import Joi from "joi";

// Long enough for a name that arrived percent-encoded: a directory name of
// 40 non-Latin-1 characters is 240 characters once encoded, and refusing it
// would refuse exactly the operators the encoding exists to serve.
const ACTOR_MAX = 512;

// Who a mutation is made on behalf of, read from the `x-actor` request header.
// Optional: an unattributed redrive is still a redrive. Validated here so a
// 200-character header is a 400 rather than something written to an audit
// event and to a document.
export const actorHeaderSchema = Joi.object({
  "x-actor": Joi.string().trim().max(ACTOR_MAX).empty("").optional(),
})
  .unknown(true)
  .label("ActorHeaders");
