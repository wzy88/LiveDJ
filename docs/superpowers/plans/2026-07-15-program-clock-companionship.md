# Program Clock Companionship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-track four-point talk scheduling with a six-track companionship clock that includes callbacks, deliberate silence, and a soft handoff.

**Architecture:** Add a pure `server/program-clock.js` module that assigns roles and builds stage arrays from the existing script schema. Integrate it before talk-brief generation and after script enrichment, then teach talk briefs and the LLM payload about the assigned role. Preserve explicit empty stage arrays in the browser.

**Tech Stack:** Node.js ES modules, Node test runner, React source-level runtime tests.

## Global Constraints

- Keep recommendation and queue planning unchanged.
- Preserve the existing talk-script fields for compatibility.
- An explicit empty `stages` array means intentional silence.
- Use tests first for every behavior change.

---

### Task 1: Pure Program Clock

**Files:**
- Create: `server/program-clock.js`
- Create: `server/program-clock.test.js`

**Interfaces:**
- Produces: `assignProgramClock(queue, { blockSize = 6 } = {})` mutates each track with `programClock` and returns the queue.
- Produces: `buildProgramClockStages(script, track)` returns the role-specific stage array.

- [ ] Write failing tests for the six roles, `[1, 1, 1, 0, 1, 2]` stage counts, repeated blocks, and clean micro-touch compaction.
- [ ] Run `node --test server/program-clock.test.js` and confirm failure because the module does not exist.
- [ ] Implement the role templates, source selection, timings, and punctuation-aware micro-touch compaction.
- [ ] Run `node --test server/program-clock.test.js` and confirm all tests pass.

### Task 2: Server Integration and Talk Briefs

**Files:**
- Modify: `server/radio-program.js`
- Modify: `server/radio-program.test.js`
- Modify: `server/talk-brief.js`
- Modify: `server/talk-brief.test.js`
- Modify: `server/llm.js`
- Modify: `server/llm.test.js`

**Interfaces:**
- Consumes: `assignProgramClock` and `buildProgramClockStages` from Task 1.
- Produces: `talkBrief.programClock` with `role`, `label`, `playedFields`, and `writingInstruction`.

- [ ] Write failing integration tests asserting the six-track role/stage pattern and skipped LLM call for `trust_window`.
- [ ] Write a failing talk-brief test asserting that `callback` asks for elapsed-time or earlier-scene continuity.
- [ ] Run the focused server tests and confirm the new assertions fail for missing behavior.
- [ ] Assign roles before `attachTalkBriefs`, skip LLM enrichment for silent tracks, and build stages through the program-clock module.
- [ ] Include normalized program-clock guidance in the LLM talk brief.
- [ ] Run the focused server tests and confirm they pass.

### Task 3: Browser Silence Semantics

**Files:**
- Modify: `src/main.jsx`
- Modify: `src/continuous-playback.test.js`

**Interfaces:**
- Consumes: `script.stages`, including an intentional empty array.
- Produces: no timers when `script.stages` is an empty array; legacy fallback only when the property is absent.

- [ ] Add a failing source-level test that distinguishes `Array.isArray(script.stages)` from a non-empty check.
- [ ] Run `node --test src/continuous-playback.test.js` and confirm failure.
- [ ] Change `scheduleTalkover` to preserve an explicit empty stage array.
- [ ] Run `node --test src/continuous-playback.test.js` and confirm it passes.

### Task 4: Regression Verification

**Files:**
- Modify only files required by failures caused by the program-clock change.

**Interfaces:**
- Consumes: all behavior from Tasks 1-3.
- Produces: a buildable application with the new talk cadence.

- [ ] Run all tests with `node --test server/*.test.js src/*.test.js`.
- [ ] Run `npm run build`.
- [ ] Inspect a generated six-track rule-based program and report its roles, stage counts, and spoken text.
- [ ] Review the final diff for unrelated changes and leave the user's existing work intact.
