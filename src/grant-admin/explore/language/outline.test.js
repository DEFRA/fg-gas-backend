import { describe, expect, it } from "vitest";
import { SOURCES } from "./allowlist.js";
import { lex } from "./lex.js";
import { outlineProblem } from "./outline.js";

const problemOf = (text) => outlineProblem(text, lex(text), SOURCES);

describe("outlineProblem", () => {
  it.each([
    ["db.applications.find({ # })", "“#” isn’t part of a query", "#"],
    [
      "db.applications.find({ business: 'hill })",
      "This text isn’t closed: add '",
      "'hill })",
    ],
    [
      'db.applications.find({ business: "hill })',
      'This text isn’t closed: add "',
      '"hill })',
    ],
    [
      "db.applications.find({ business: /hill })",
      "This pattern isn’t closed: add /",
      "/hill })",
    ],
    ["db.applications.find({ a: 1 }))", "This ) closes nothing", "))"],
    ["db.applications.find({ a: [1 })", "This } closes nothing", "}"],
    ["db.applications.find({ a: 1 ", "This { isn’t closed: add }", "{ a"],
    ["db.applications.find({ a: 1 }", "This ( isn’t closed: add )", "({"],
    ["db.applications.find({ a: { b: 1 })", "This ) closes nothing", ")"],
    [
      "applications.find()",
      "Start with db. and what to look in: db.applications.find({ … })",
      "applications",
    ],
    ["db applications.find()", "Add . after db", "applications"],
    [
      "'db'.applications.find()",
      "Start with db. and what to look in: db.applications.find({ … })",
      "'db'",
    ],
    [
      "/db/.applications.find()",
      "Start with db. and what to look in: db.applications.find({ … })",
      "/db/",
    ],
    [
      "db.users.find()",
      "db.applications, cases, grants, workflows, events, agreements or payments",
      "users",
    ],
    [
      "db.cases.findOne({})",
      "A method goes here: find, aggregate, countDocuments or distinct",
      "findOne",
    ],
    ["db.cases.find({}).skip(5)", "Then .sort({ … }) or .limit(…)", "skip"],
    [
      "db.cases.constructor()",
      "A method goes here: find, aggregate, countDocuments or distinct",
      "constructor",
    ],
    [
      "db.applications.find({ area: { $where: 1 } })",
      "$where isn’t one of the operators you can use",
      "$where",
    ],
    [
      "db.events.aggregate([{ $lookup: {} }])",
      "$lookup isn’t one of the operators you can use",
      "$lookup",
    ],
  ])("refuses %j: %s", (text, message, at) => {
    const problem = problemOf(text);
    const start = at === "))" ? text.length - 1 : text.indexOf(at);

    expect(problem).toMatchObject({ message, at: start });
  });

  it("points past the end when something is missing", () => {
    expect(problemOf("db.cases")).toEqual({
      message:
        "Add a method: .find(…), .aggregate(…), .countDocuments(…) or .distinct(…)",
      at: 8,
      end: 9,
    });
    expect(problemOf("db")).toEqual({
      message: "Add . after db",
      at: 2,
      end: 3,
    });
    expect(problemOf("db.")).toMatchObject({ at: 3, end: 4 });
  });

  it("asks for a query when there is none, comments aside", () => {
    expect(problemOf(" // nothing")).toMatchObject({
      message:
        "Start with db. and what to look in: db.applications.find({ … })",
    });
  });

  it("lists the sources it is given, in their order", () => {
    expect(
      outlineProblem("db.x.find()", lex("db.x.find()"), ["cases", "events"]),
    ).toMatchObject({ message: "db.cases or events" });
  });

  it("accepts $options, which the editor doesn't know yet", () => {
    expect(
      problemOf("db.applications.find({ b: { $regex: 'h', $options: 'i' } })"),
    ).toBeNull();
  });

  it("finds nothing wrong with a well-formed query", () => {
    expect(
      problemOf(
        "db.cases.find({ status: 'In review' }, { ref: 1 }).sort({ created: -1 }).limit(5);",
      ),
    ).toBeNull();
  });
});
