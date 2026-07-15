# Program Clock Companionship Design

## Goal

Change Claudio from track-centric commentary to a six-track program block that preserves frequent host presence without repeatedly interrupting every song.

The listener should feel that one host is following the same moment over time. Spoken segments must show continuity through an opening, a light touch, a callback, a deliberate music-only window, a mid-block adjustment, and a soft handoff.

## Program Clock

One block contains up to six tracks. Roles repeat for later queue backfills.

| Track index | Role | Spoken behavior |
| --- | --- | --- |
| 0 | `block_open` | One full opening near the start: establish the listener's present scene. |
| 1 | `presence_touch` | One short line near the end: signal that the host is still present. |
| 2 | `callback` | One medium line near the start: acknowledge elapsed time or echo the earlier scene. |
| 3 | `trust_window` | No spoken stages. Music carries the companionship. |
| 4 | `mid_anchor` | One full line near the start: adjust the direction of the block based on its progress. |
| 5 | `soft_handoff` | A short touch near the start and a soft continuation near the end. Do not announce a hard ending. |

A complete six-track block therefore contains six spoken stages, including one fully silent song. This replaces the former maximum of four stages per track.

## Runtime Model

Each track receives a `programClock` object before talk briefs and scripts are generated:

```js
{
  blockIndex: 0,
  trackIndex: 2,
  role: "callback",
  label: "前文回声",
  playedFields: ["opening"]
}
```

After rule or LLM scripts are ready, the program-clock scheduler converts only the fields needed by that role into `script.stages`. It preserves the existing stage timing schema used by the browser.

An explicit `script.stages: []` means intentional silence. The browser must not replace it with fallback talk stages. Fallback stages are allowed only when the `stages` property is absent, for compatibility with older payloads.

## Writing Responsibilities

The talk brief must expose the assigned role and a role-specific instruction to the LLM.

- `block_open`: see the listener and establish one concrete scene.
- `presence_touch`: use one short clause, without explaining the song.
- `callback`: refer to elapsed time, a previous instruction, or a continuing action.
- `trust_window`: generate no LLM script and spend no script budget.
- `mid_anchor`: make one observable adjustment to energy, density, or emotional direction.
- `soft_handoff`: show that Claudio remains present and the program continues.

The scheduler may compact a source line for a micro-touch, but it must cut at Chinese sentence or clause punctuation and must not append an ellipsis or leave obviously broken punctuation.

## Boundaries

- Keep the recommendation and queue-planning algorithms unchanged.
- Keep the existing `opening`, `bridges`, `nextTease`, and `closing` script schema for compatibility.
- Do not add audio analysis or lyric-aware placement in this iteration.
- Do not redesign the player UI.
- Do not require an LLM for the program clock; rule-based scripts must produce the same stage structure.

## Verification

Automated tests must prove:

1. Six tracks receive the six expected roles.
2. The stage counts are `[1, 1, 1, 0, 1, 2]`.
3. The trust-window track keeps `stages: []` in the browser.
4. Micro-touch text is compacted without malformed endings.
5. The trust-window track skips its LLM call.
6. Talk briefs expose role-specific writing instructions.
7. Existing server and frontend tests still pass.

