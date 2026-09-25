# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Personal workbench (个人工作台): task management + time tracking (pomodoro, clock-in/out, task focus timers).
Ships as both a browser app and a Tauri 2 desktop app from the same React frontend.
UI strings, commit-visible copy, and README are in Chinese — match that when adding user-facing text.

## Commands

```bash
pnpm dev            # Vite dev server on :5173 (strictPort)
pnpm dev:host       # same, bound to 0.0.0.0
pnpm lint           # oxlint (the only linter; this is what CI runs)
pnpm typecheck      # tsc -b
pnpm build          # tsc -b && vite build
pnpm tauri:dev      # desktop dev (spawns `pnpm dev` itself via beforeDevCommand)
pnpm tauri:build    # desktop bundle
```

There is no test framework. Verification = `pnpm lint && pnpm typecheck && pnpm build`, plus running the app.

On NixOS/WSL, `nix-shell` provides Node, Rust, and the GTK/WebKit native deps Tauri needs (`shell.nix`).

## Architecture

### One state object, one hook

`src/hooks/useWorkbench.ts` owns the entire `WorkbenchState` (`tasks`, `timeEntries`, `checkins`,
`lastOpenedResourceId`) and exposes every mutation as a callback. `App.tsx` destructures it and passes
callbacks down as props — there is no context, no reducer, no router, no state library.

All mutations are immutable `setState` updates. Two invariants are maintained by convention, not by types:
- **Active focus timer** = the single `timeEntry` with `type: 'focus'` and `endedAt === null`. Anything that
  starts a timer first ends the open one (`endOpenFocus`).
- **Active check-in** = the single `checkin` with `clockOutAt === null`. `clockIn` closes any open one first.

Persistence is a `useEffect` that writes the *whole* state on every change, gated on a `ready` flag so the
initial empty state never clobbers stored data. Keep that gate intact.

### Dual persistence backend

`src/data/workbenchRepository.ts` is the only place that branches on runtime:

- Browser → `src/storage.ts`, `localStorage` key `personal-workbench:v1`. `loadState()` also does defensive
  migration of legacy records (e.g. `resource.url` → `resource.target`) and falls back to a seeded demo state.
- Tauri → `invoke('load_workbench')` / `invoke('save_workbench')` against SQLite at
  `<appDataDir>/workbench.sqlite3`.

`save_workbench` (`src-tauri/src/lib.rs`) is a **full snapshot replace**: it deletes all rows in `tasks`,
`time_entries`, `checkins` and reinserts inside one transaction. Don't assume incremental writes or row-level
history exist.

### Type mirroring across the FFI boundary

`src/types.ts` and the Rust structs in `src-tauri/src/lib.rs` are hand-mirrored. Rust uses
`#[serde(rename_all = "camelCase")]`, plus `TimeEntry.entry_type` ↔ `"type"` and a `url` alias on
`TaskResource.target` for old payloads. **Adding or renaming a field means editing three places**: the TS
interface, the Rust struct, and the `CREATE TABLE` / `INSERT` / `SELECT` SQL in `init_db` + the two commands.
`tasks.resources` is not a table — it is serialized to the `resources_json` column.

### Resources and platform capability split

A task holds `TaskResource[]` of kind `url | file | app`. Web can only open `url`. Desktop opens all three via
the `open_resource` command, which shells out to `open` / `start` / `xdg-open` per platform.

`open_resource` signals a missing file/app by returning the literal error string `RESOURCE_NOT_FOUND`; the
frontend substring-matches it and prompts the user to unlink the resource from the task. Preserve that sentinel
on both sides if you touch it. `open_external` rejects anything that isn't `http(s)://`.

`isTauri()` (`src/lib/tauri.ts`) sniffs `__TAURI_INTERNALS__` on `window` — use it for any capability gate.

### Navigation quirk

`App.tsx` switches sections with a `useState`, conditionally rendering Dashboard and Tasks. **TimePage is always
mounted** and hidden with the `section-hidden` CSS class — its pomodoro/stopwatch intervals must keep running
when you navigate away. Don't "clean this up" into a conditional render.

`TaskForm` is remounted on open via a `key` so it re-seeds its fields from the edited task.

### Deferred completion toggle

Checking an unfinished task does **not** call `onToggleDone` immediately. `TaskCard` owns a small
`completionPhase` state machine: it plays a slide-down/fade-out (`is-completing`), commits the toggle after
`MOTION_DURATION_MS`, then plays a drop-in (`is-settling`) at the card's new sorted position. The duration is a
TS constant injected into CSS as `--task-motion-duration`, so change it in one place. Two safeguards must stay:
the unmount cleanup flushes a pending commit (the Dashboard drops done tasks, so the card unmounts mid-animation),
and `prefersReducedMotion()` bypasses the delay entirely.

## Conventions

- Styling: one global stylesheet `src/index.css` (~1.3k lines) with plain semantic class names. No Tailwind,
  CSS modules, or component libraries.
- Date/duration/format helpers and `sortTasks` live in `src/utils.ts` — reuse them rather than inlining
  `Intl.DateTimeFormat`.
- IDs come from `createId()` (crypto.randomUUID with a fallback); timestamps are ISO strings via `nowIso()`;
  day buckets use `toDateKey()` (local time, not UTC).
- `tsconfig.app.json` sets `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, and
  `verbatimModuleSyntax` — type-only imports must use `import type`.
- Conventional Commits. Version lives in **three** files that are kept in lockstep: `package.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.

## CI

`.github/workflows/build-macos.yml` runs on push to `main`, on `v*` tags, and manually: `pnpm lint` then a
Tauri build for `aarch64-apple-darwin`. Signing/notarization is skipped unless the `APPLE_*` secrets are set.
Tagged builds publish the DMG as a GitHub release.
