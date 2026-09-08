import { describe, expect, it } from "vitest";
import { decodeActor } from "./actor-header.js";

// The pair to `toHeaderActor` in the admin frontend: it encodes a name a
// header cannot carry, this reads it back. Node refuses to send a header value
// containing anything above U+00FF, so before the pair existed an operator
// called `Łukasz` could not redrive at all - the send threw, and the page
// reported it as this service being unreachable.
describe("decodeActor", () => {
  it.each([
    ["Łukasz", "UTF-8''%C5%81ukasz"],
    ["Ŵyn", "UTF-8''%C5%B4yn"],
    ["Ada Løvelace", "UTF-8''Ada%20L%C3%B8velace"],
  ])("reads %s back out of its encoded form", (name, encoded) => {
    expect(decodeActor(encoded)).toBe(name);
  });

  // A name that needed no encoding travels as itself, which is what lets the
  // two services be deployed in either order.
  it.each([
    ["a plain name", "Ada Lovelace"],
    ["a name with an apostrophe", "Grace O'Neill"],
    ["a Latin-1 name a header can hold", "Ada Løvelace"],
  ])("takes %s exactly as it arrived", (_name, actor) => {
    expect(decodeActor(actor)).toBe(actor);
  });

  it.each([
    ["nobody named themselves", undefined],
    ["the header was absent", null],
  ])("passes through when %s", (_name, actor) => {
    expect(decodeActor(actor)).toBe(actor);
  });

  // A redrive is not worth refusing over the spelling of the name attached to
  // it, and a name that reads oddly beats no name at all in an audit record.
  it("keeps a malformed encoding rather than dropping the actor", () => {
    expect(decodeActor("UTF-8''%E0%A4%A")).toBe("UTF-8''%E0%A4%A");
  });

  // The marker is what says "this was encoded"; without it the value is a
  // name, even one that happens to contain a percent sign.
  it("leaves a name containing a percent sign alone", () => {
    expect(decodeActor("100%25 Ada")).toBe("100%25 Ada");
  });
});
