// The operator a mutation is made on behalf of, as the wire can carry them.
//
// An HTTP header value is bytes, and Node refuses to send anything above
// U+00FF in one - so a caller whose directory name is `Łukasz` or `Ŵyn` could
// not name themselves at all: the send threw before the request left, and the
// admin frontend reported it as this service being unreachable.
//
// The frontend now encodes such a name the way RFC 8187 encodes a header
// parameter, and only when it has to. This reverses that, and only when it
// sees the marker: a name that needed no encoding arrives exactly as it always
// did, which is what lets the two services deploy in either order.

const ENCODED_PREFIX = "UTF-8''";

/**
 * Decoded where the marker says so, verbatim everywhere else.
 *
 * A value that claims to be encoded and is not decodable is kept as it stands
 * rather than dropped: a redrive is not worth refusing over the spelling of
 * the name attached to it, and a name that reads oddly in an audit record is
 * still better than no name at all.
 */
export const decodeActor = (actor) => {
  if (!actor?.startsWith(ENCODED_PREFIX)) {
    return actor;
  }

  try {
    return decodeURIComponent(actor.slice(ENCODED_PREFIX.length));
  } catch {
    return actor;
  }
};
