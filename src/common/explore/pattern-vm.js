import { LINE_ENDS, codeOf, memoised } from "./pattern-tree.js";

// The meter's unit is about two thirds of a microsecond; the matcher takes
// about 40 ns a step, so this many steps are one unit (pattern.test.js times
// it). A literal is charged as any comparison: one, and one more each 20
// characters.
export const STEPS_PER_UNIT = 16;
export const LENGTH_STEP = 20;

// The matcher charges its work each time it has taken this many steps, so
// the meter can stop it part way through a long value.
const CHARGE_STEPS = 1024;

// ── Counting states before building any ──

const copiesOf = ({ min, max }) =>
  Math.max(1, max === Infinity ? min + 1 : max);

const STATES = {
  group: (node) => statesOf(node.inner),
  sequence: (node) => node.items.reduce((n, item) => n + statesOf(item), 1),
  alternation: (node) =>
    node.options.reduce((n, option) => n + statesOf(option) + 1, 1),
  repeat: (node) => (statesOf(node.inner) + 1) * copiesOf(node),
};

export const statesOf = (node) =>
  Object.hasOwn(STATES, node.type) ? STATES[node.type](node) : 1;

// ── Building the program ──

const identity = (ch) => ch;

const charTest = (ch, fold) => {
  const wanted = fold(ch);

  return (got) => fold(got) === wanted;
};

const inRange = (from, to) => (got) =>
  codeOf(got) >= codeOf(from) && codeOf(got) <= codeOf(to);

// With i, a range holds a character if it holds any of its class.
const foldedRange = (from, to, members) => {
  const test = inRange(from, to);

  return (got) => members(got).some(test);
};

const ITEMS = {
  range: (item, options) =>
    options.folding
      ? foldedRange(item.from, item.to, options.members)
      : inRange(item.from, item.to),
  set: (item, options) => options.sets[item.name],
  char: (item, options) =>
    charTest(item.ch, options.folding ? options.fold : identity),
};

// A class's answer for each character, worked out once: a step never folds
// or allocates again for a character it has seen.
const classTest = (node, options) => {
  const tests = node.items.map((item) => ITEMS[item.type](item, options));
  const holds = (got) => tests.some((test) => test(got));

  return memoised(node.negated ? (got) => !holds(got) : holds);
};

const notLineEnd = (got) => !LINE_ENDS.has(got);

// A step on a class is charged its items, as a class may test each.
const weightOf = (node) => (node.type === "class" ? node.items.length : 1);

const testsOf = (options) => {
  const { fold, folding, dotAll, sets } = options;
  // One test per class, however many copies a repeat makes of it.
  const classes = new WeakMap();
  const sharedClass = (node) => {
    if (!classes.has(node)) {
      classes.set(node, classTest(node, options));
    }

    return classes.get(node);
  };

  return {
    char: (node) => charTest(node.ch, folding ? fold : identity),
    any: () => (dotAll ? () => true : notLineEnd),
    set: (node) => sets[node.name],
    class: (node) => sharedClass(node),
  };
};

export const builder = (options) => {
  const program = [];
  const emit = (op) => program.push(op) - 1;
  const here = () => program.length;

  const TESTS = testsOf(options);

  const optional = (node) => {
    const split = emit({ op: "split" });

    build(node);
    program[split].next = [split + 1, here()];
  };

  const star = (node) => {
    const split = emit({ op: "split" });

    build(node);
    emit({ op: "jump", to: split });
    program[split].next = [split + 1, here()];
  };

  const option = (jumps, last) => (node, n) => {
    const split = n === last ? null : emit({ op: "split" });

    build(node);

    if (split !== null) {
      jumps.push(emit({ op: "jump" }));
      program[split].next = [split + 1, here()];
    }
  };

  const repeat = (node) => {
    Array.from({ length: node.min }).forEach(() => build(node.inner));

    if (node.max === Infinity) {
      star(node.inner);

      return;
    }

    Array.from({ length: node.max - node.min }).forEach(() =>
      optional(node.inner),
    );
  };

  const COMPOUND = {
    assert: (node) => emit({ op: "assert", kind: node.kind }),
    group: (node) => build(node.inner),
    sequence: (node) => node.items.forEach(build),
    alternation: (node) => {
      const jumps = [];

      node.options.forEach(option(jumps, node.options.length - 1));
      jumps.forEach((jump) => {
        program[jump].to = here();
      });
    },
    repeat,
  };

  const build = (node) => {
    if (Object.hasOwn(TESTS, node.type)) {
      emit({
        op: "char",
        test: TESTS[node.type](node),
        weight: weightOf(node),
      });

      return;
    }

    COMPOUND[node.type](node);
  };

  return (tree) => {
    build(tree);
    emit({ op: "match" });

    return program;
  };
};

// ── Matching: a Pike VM, every thread a character at a time ──

const isWordAt = (vm, at) =>
  at >= 0 && at < vm.chars.length && vm.word(vm.chars[at]);

const ASSERTS = {
  start: (vm, at) =>
    at === 0 || (vm.multiline && LINE_ENDS.has(vm.chars[at - 1])),
  end: (vm, at) =>
    at === vm.chars.length || (vm.multiline && LINE_ENDS.has(vm.chars[at])),
  word: (vm, at) => isWordAt(vm, at - 1) !== isWordAt(vm, at),
  notWord: (vm, at) => isWordAt(vm, at - 1) === isWordAt(vm, at),
};

// The VM's lists are typed arrays made once per value, so a step allocates
// nothing: `list` holds the states reached at this character.
const push = (stack, top, pc) => {
  stack[top] = pc;

  return top + 1;
};

const FOLLOW = {
  jump: (op, _pc, vm, _at, top) => push(vm.stack, top, op.to),
  split: (op, _pc, vm, _at, top) =>
    push(vm.stack, push(vm.stack, top, op.next[1]), op.next[0]),
  assert: (op, pc, vm, at, top) =>
    ASSERTS[op.kind](vm, at) ? push(vm.stack, top, pc + 1) : top,
};

const followed = (vm, pc, at, top) => {
  const op = vm.program[pc];

  if (Object.hasOwn(FOLLOW, op.op)) {
    return FOLLOW[op.op](op, pc, vm, at, top);
  }

  vm.list[vm.count] = pc;
  vm.count += 1;

  return top;
};

// Every state reachable from `pc` without reading a character, each once.
const addThread = (vm, pc, at) => {
  let top = push(vm.stack, 0, pc);

  while (top > 0) {
    top -= 1;

    const next = vm.stack[top];

    if (vm.seen[next] !== vm.mark) {
      vm.seen[next] = vm.mark;
      vm.steps += 1;
      top = followed(vm, next, at, top);
    }
  }
};

const stepAt = (vm, current, count, at) => {
  vm.mark += 1;
  vm.count = 0;

  for (let n = 0; n < count; n += 1) {
    addThread(vm, current[n], at);
  }

  addThread(vm, 0, at);
};

// The states after reading `ch`, into `into`; how many.
const advance = (vm, ch, into) => {
  let count = 0;

  for (let n = 0; n < vm.count; n += 1) {
    const pc = vm.list[n];
    const op = vm.program[pc];

    vm.tested += op.weight ?? 0;

    if (op.test(ch)) {
      into[count] = pc + 1;
      count += 1;
    }
  }

  return count;
};

const hasMatched = (vm) => {
  for (let n = 0; n < vm.count; n += 1) {
    if (vm.program[vm.list[n]].op === "match") {
      return true;
    }
  }

  return false;
};

const vmOf = (program, chars, { multiline, word, charge }) => ({
  program,
  chars,
  multiline,
  word,
  charge,
  charged: 0,
  chargedSteps: 0,
  tested: 0,
  seen: new Int32Array(program.length),
  mark: 0,
  steps: 0,
  list: new Int32Array(program.length),
  count: 0,
  stack: new Int32Array(program.length * 2 + 2),
});

const unitsOf = (steps) => Math.ceil(steps / STEPS_PER_UNIT);

// Charges the units taken since the last charge; the meter may stop here.
// The work is the states visited and the class items tested.
const workOf = (vm) => vm.steps + vm.tested;

const chargeSoFar = (vm) => {
  const units = unitsOf(workOf(vm));

  vm.charge(units - vm.charged);
  vm.charged = units;
  vm.chargedSteps = workOf(vm);
};

const outcomeOf = (vm, matched) => {
  chargeSoFar(vm);

  return { matched, steps: vm.steps, cost: vm.charged };
};

// The states at one place in the value; true once one has matched.
const readAt = (vm, lists, at) => {
  stepAt(vm, lists.current, lists.count, at);

  if (hasMatched(vm)) {
    return true;
  }

  if (workOf(vm) - vm.chargedSteps >= CHARGE_STEPS) {
    chargeSoFar(vm);
  }

  lists.count =
    at < vm.chars.length ? advance(vm, vm.chars[at], lists.next) : 0;
  [lists.current, lists.next] = [lists.next, lists.current];

  return false;
};

export const runVm = (program, chars, options) => {
  const vm = vmOf(program, chars, options);
  const lists = {
    current: new Int32Array(program.length),
    next: new Int32Array(program.length),
    count: 0,
  };

  for (let at = 0; at <= chars.length; at += 1) {
    if (readAt(vm, lists, at)) {
      return outcomeOf(vm, true);
    }
  }

  return outcomeOf(vm, false);
};
