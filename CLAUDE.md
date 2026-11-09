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
pnpm test           # node --test over server/test and tests/ (sync server + sync engine)
node --test server/test/store.test.ts   # a single test file
```

Verification = `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus running the app. There is no
test framework dependency: tests use Node's built-in `node:test` and run TypeScript directly through Node 24's
type stripping. That only works for modules that use `import type` for types and import values with an
explicit `.ts` extension (`allowImportingTsExtensions`) — keep `server/src/*`, `src/sync/*` and
`src/data/records.ts` that way, or they stop being testable. UI components are not covered by tests.

`tsc -b` has three projects: `tsconfig.app.json` (the app), `tsconfig.node.json` (vite config) and
`tsconfig.server.json` (`server/`, `tests/`, with `strict` and Node types).

On NixOS/WSL, `nix-shell` provides Node, Rust, and the GTK/WebKit native deps Tauri needs (`shell.nix`).

## Architecture

### One state object, one hook

`src/hooks/useWorkbench.ts` owns the entire `WorkbenchState` (`tasks`, `timeEntries`, `checkins`,
`lastOpenedResourceId`, `sync`) and exposes every mutation as a callback. `App.tsx` destructures it and passes
callbacks down as props — there is no context, no reducer, no router, no state library.

The hook holds two views of the data. **`store`** is everything, including tombstones, and is what gets
persisted and synced. **`state`** is `liveView(store)` — tombstones filtered out — and is what every page sees.
Deletes and clears never remove records: they set `deletedAt` (`tombstone()` in `src/data/records.ts`),
otherwise another device's copy would bring them back on the next sync. Every mutation must also stamp
`updatedAt` with the current time; use `updateLive()`, which only touches live records and stamps changed ones.
A mutation that forgets either rule silently breaks sync conflict resolution. `lastOpenedResourceId` is
device-local and deliberately not stamped.

All mutations are immutable `setState` updates. Two invariants are maintained by convention, not by types:
- **Active focus timer** = the single `timeEntry` with `type: 'focus'` and `endedAt === null`. Anything that
  starts a timer first ends the open one (`endOpenFocus`).
- **Active check-in** = the single `checkin` with `clockOutAt === null`. `clockIn` closes any open one first.

`activeCheckin` means "a shift is open *right now*", **not** "checked in today" — after clocking out it is
null again. Any UI that reports the day's check-in state must use `summarizeCheckins()` (`src/utils.ts`)
instead, which returns a discriminated union over the real three states: `none` / `working` / `finished`.
It also folds in an open shift that started on a previous day. Treating `activeCheckin` as a boolean for
"has checked in" is the bug fixed in v0.5.3.

There are deliberately **two different rules** for an unclosed (`clockOutAt === null`) check-in, and mixing
them up reintroduces a bug:
- **Live views** (dashboard, Time page banner, tray) go through `summarizeCheckins()`, which uses
  `durationSeconds(clockInAt, null)` to show real-time elapsed duration for whatever shift is currently open
  — this is correct and intentional, including the overnight-shift fold-in above.
- **Retrospective aggregates** (本月统计, and anything built from historical check-in records) must go
  through `summarizeCompletedCheckins()` instead, which drops any check-in with no `clockOutAt` entirely
  (duration 0, not counted toward day totals). Without this, a shift someone forgot to clock out of keeps
  accumulating against "now" forever and the monthly total grows every day it stays open — that was the bug
  fixed in v0.6.1. Do not call `durationSeconds(checkin.clockInAt, checkin.clockOutAt)` directly on a list of
  historical check-ins; `clockOutAt` may be `null` and `durationSeconds` silently falls back to `Date.now()`.

Persistence is a `useEffect` that writes the *whole* state on every change, gated on a `ready` flag so the
initial empty state never clobbers stored data. Keep that gate intact.

### Retroactive check-in (补卡)

`addCheckin` / `updateCheckin` insert or correct a historical shift. Unlike `clockIn`, `addCheckin` does
**not** close an open shift — it is writing the past, not starting the present — and it stamps `note: '补卡'`
so the history row can badge it (`note` already round-trips through SQLite, so no schema change was needed).
`date` is always re-derived from `clockInAt` via `toDateKey`, since editing the time can move a shift to
another day.

`CheckinForm` validates before committing: `combineDateAndTime` builds local-time ISO from the date + `HH:mm`
inputs, a clock-out at or before the clock-in is treated as crossing midnight and pushed a day later
(`shiftIsoByDays`), and `findCheckinOverlap` rejects a range that collides with an existing shift
(touching endpoints are allowed; an open shift counts as extending to infinity). The form captures an
`openedAt` timestamp once instead of calling `Date.now()` during render — oxlint's `react(purity)` rule flags
that — and re-validates against the real clock on submit.

### Dual persistence backend

`src/data/workbenchRepository.ts` is the only place that branches on runtime:

- Browser → `src/storage.ts`, `localStorage` key `personal-workbench:v1`. `loadState()` also does defensive
  migration of legacy records (e.g. `resource.url` → `resource.target`) and falls back to a seeded demo state.
- Tauri → `invoke('load_workbench')` / `invoke('save_workbench')` against SQLite at
  `<appDataDir>/workbench.sqlite3`.

`save_workbench` (`src-tauri/src/lib.rs`) is a **full snapshot replace**: it deletes all rows in `tasks`,
`time_entries`, `checkins` and reinserts inside one transaction. Don't assume incremental writes or row-level
history exist. The `sync` metadata (`device_id`, `sync_cursor`, …) is written to the `settings` table in that
same transaction, so a sync cursor can never advance without the data it pulled.

**Always write settings through `write_setting()`**, which deletes the key when the value is `None`.
`settings.value` is `NOT NULL`, and an `INSERT OR REPLACE` of `NULL` aborts — which rolls back the *whole* save.
Up to v0.7.4 `lastOpenedResourceId` was written that way, so nothing was persisted on a fresh install until a
resource had been opened, or after 「清空全部」 (fixed in the sync release).

Schema changes go through `migrate()`, keyed on `PRAGMA user_version` (`SCHEMA_VERSION`). Each migration runs
in one transaction; before migrating a database that has data, it writes a consistent copy with
`VACUUM INTO` (`workbench.backup-schema<N>-<unixtime>.sqlite3` in the app data dir — plain file copies can miss
WAL contents). New columns must be nullable: a downgraded build still inserts rows without them, and `load`
backfills with `COALESCE`. Never edit an existing `MIGRATION_Vn` — add `V(n+1)`.

### Type mirroring across the FFI boundary

`src/types.ts` and the Rust structs in `src-tauri/src/lib.rs` are hand-mirrored. Rust uses
`#[serde(rename_all = "camelCase")]`, plus `TimeEntry.entry_type` ↔ `"type"` and a `url` alias on
`TaskResource.target` for old payloads. **Adding a field means editing four places**: the TS interface, the
Rust struct (with `#[serde(default)]`), a new nullable column in a new `MIGRATION_Vn`, and the `INSERT` /
`SELECT` in `save_workbench` / `load_workbench`. Do **not** add the column to `init_db`'s `CREATE TABLE`:
a fresh database runs `init_db` and then every migration, so the `ALTER TABLE ADD COLUMN` would fail as a
duplicate. Fields inside a resource need no migration — `tasks.resources` is serialized to the
`resources_json` column. A field that should sync also has to round-trip through `server/` untouched, which
it does automatically: the server stores each record's `data` as opaque JSON.

### Resources and platform capability split

A task holds `TaskResource[]` of kind `url | file | app`. Web can only open `url`. Desktop opens all three via
the `open_resource` command, which shells out to `open` / `start` / `xdg-open` per platform.

`open_resource` signals a missing file/app by returning the literal error string `RESOURCE_NOT_FOUND`; the
frontend substring-matches it and prompts the user to unlink the resource from the task. Preserve that sentinel
on both sides if you touch it. `open_external` rejects anything that isn't `http(s)://`.

File/app resources carry the `deviceId` of the Mac that added them, because their `target` is an absolute
path on that machine. `isRemoteResource()` gates opening **and** the unlink prompt: offering "取消关联" for
another Mac's path would sync the deletion back and remove a perfectly valid resource there. When a task is
edited, `normalizeResource` keeps the old `deviceId` unless the kind or path changed. Resources from before
sync existed are claimed for the local device on load (`claimLegacyResources`), before the first sync.

`isTauri()` (`src/lib/tauri.ts`) sniffs `__TAURI_INTERNALS__` on `window` — use it for any capability gate.

### System tray (desktop only)

The pomodoro state machine lives in `src/hooks/usePomodoro.ts`, lifted out of `PomodoroTimer` so both the
Time page and the tray drive the *same* timer. `App.tsx` owns it and passes the `PomodoroController` down;
`PomodoroTimer` is now a pure view over that controller.

`src/hooks/useTray.ts` is the bridge, and it is one-way by design: the frontend formats **all** tray strings
into a `TraySnapshot` and ships them to `update_tray`; Rust never formats or computes anything. That keeps the
Chinese labels and duration formatting in one language. A serialized-snapshot comparison suppresses redundant
IPC, and a 30s interval refreshes the worked-time label only while a check-in is open.

The reverse direction is the `tray://toggle-pomodoro` and `tray://toggle-checkin` events, emitted by the Rust
menu handler and consumed via `listenTrayEvent`. The event names are duplicated in `src/lib/tray.ts` and
`src-tauri/src/tray.rs` — keep them in sync. Menu actions are dispatched through an `actionsRef`, so the
listeners register once while still calling the latest handlers.

The macOS menu bar icon is drawn procedurally in `src-tauri/src/tray_icon.rs` — a black-plus-alpha template
image (`icon_as_template(true)`) that the system inverts for light/dark menu bars. It's SDF math rather than a
committed PNG, which avoids a binary asset and the `image-png` cargo feature. `tray-icon` scales any tray image
to 18pt tall, so the 36px canvas is exactly Retina 2x. Other platforms keep the full-colour app icon, since
their tray backgrounds aren't predictable.

Nothing is written next to the icon (no `set_title`) — the check-in duration appears only inside the menu.

`src-tauri/src/tray.rs` deliberately uses the concrete `Wry` runtime rather than a generic `R: Runtime`,
because the stored `TrayHandles` must be `Send + Sync + 'static` for `app.manage`. `update_tray` must stay a
**sync** command: sync commands run on the main thread, which is required for muda menu mutation on macOS.

Closing the main window now calls `api.prevent_close()` and hides it so timers keep running; the only real
quit paths are the tray's 退出 item and (on macOS) `RunEvent::Reopen` to restore. Anything that assumes
window-close means app-exit is wrong.

That only works because the main window sets `"backgroundThrottling": "disabled"` in `tauri.conf.json`.
WebKit's default policy suspends timers in a hidden view after ~5 minutes, which would freeze the pomodoro
tick — and with it the completion alert — whenever the window is hidden to the tray. Don't remove it.

### Pomodoro completion alert

`usePomodoro` takes an optional `onPhaseComplete` callback, fired **only** from the tick when a phase runs out
naturally — never from `skipPhase` / `resetTimer`, since a manual action needs no reminder. The event carries
`nextMinutes` so `describePhaseComplete()` can build the copy without needing settings; the in-app
`PomodoroAlert` modal and the system-side alert share that one function so their wording can't drift.

The alert depends on whether the app is in the foreground. `src-tauri/src/alert.rs` decides that in Rust
(main window visible, not minimized, and focused — switching to another app drops focus) and
`pomodoro_alert` returns it as a bool:
- **Foreground (`true`)** — `src/lib/alert.ts` plays a two-note chime synthesized with Web Audio (no audio
  asset); the in-app `PomodoroAlert` modal is the reminder.
- **Background (`false`)** — a macOS system notification via `notify-rust` (default system sound, so the chime
  is skipped). Clicking its body calls `show_main_window`, bringing a window hidden to the tray back.
  The window is **not** force-raised any more, since a notification that also steals focus defeats the point.
  The notification also carries one action button (开始休息 / 开始专注, the same `actionLabel` the modal
  uses). Clicking it emits `pomodoro://start-next` with `{ phase }` and does **not** raise the window, so the
  user can start the next phase without leaving the app they're in.

The modal is set in both cases, so returning to the app lands on the one-click next-phase button.

The command takes one `AlertContent` object (`title`, `body`, `actionLabel`, `nextPhase`), the same
"frontend formats everything" pattern as `TraySnapshot`. Rust treats `nextPhase` as an opaque token and only
echoes it back in the event. The event name is duplicated in `src/lib/alert.ts` and `src-tauri/src/alert.rs` —
keep them in sync, since a mismatch fails silently at runtime.

`App.tsx` routes both the modal button and the notification button through one `startNextPhase(phase)`,
which only starts the timer when `pomodoro.phase === phase && !pomodoro.running`. That guard matters:
Notification Center can still hold an old notification, and since `toggleTimer` is a toggle, clicking a stale
button without the check could start the wrong phase or pause a running one. The listener registers once and
reaches the latest handler through `startNextPhaseRef`.

macOS only shows the action button when the notification style is **Alerts**; Banners hide it.
`src-tauri/Info.plist` (merged into the bundle by the Tauri CLI) sets `NSUserNotificationAlertStyle` to `alert`
so new installs default to Alerts. macOS reads that key only when it first registers the app, so an install
that already registered under Banners keeps Banners until the user changes it in System Settings → 通知.

`notify-rust` (macOS-only dependency, `default-features = false` to keep zbus out) uses the
`NSUserNotificationCenter` backend: `wait_for_response` blocks until the user clicks or the notification goes
away, with callbacks delivered on the main run loop — so it runs in `tauri::async_runtime::spawn_blocking`,
never on the main thread. This mirrors `tauri-plugin-notification`'s own desktop path; the plugin itself
wasn't used because every release with desktop click support requires Tauri 2.12. `alert::setup` calls
`set_application` once — the app's bundle id when packaged, `com.apple.Terminal` under `tauri dev`. If
sending fails, or on non-macOS platforms, it falls back to the v0.7.0 behaviour of raising the window with
`request_user_attention`.

The browser build follows the same rule: a `Notification` only when the page is hidden or unfocused, and its
click focuses the tab. It has no action button — the Web Notification API only allows buttons on notifications
shown through a Service Worker, which the app doesn't have. Autoplay policy keeps an `AudioContext` silent unless created or resumed inside a user
gesture, so `primeAlerts()` runs from the 开始 button's click; a pomodoro started from the tray may therefore
have a muted chime in the foreground case, though the background case uses the system sound regardless.

### Multi-device sync (desktop only)

Several Macs sync through the user's own server (public IP, no domain). Four pieces:

- **`server/src/protocol.ts`** — the wire types and the conflict rule, imported by *both* the server and the
  client (`src/sync/*` imports it as `../../server/src/protocol.ts`). Change the rule here and nowhere else.
- **`server/`** — Node 24, zero third-party deps (`node:https`, `node:sqlite`), runs the `.ts` sources directly.
  `store.ts` keeps one row per record; `app.ts` is the HTTP handler (TLS-agnostic, so tests drive it over
  plain HTTP); `main.ts` refuses to start without TLS. Scripts: `gen-cert.sh`, `install.sh`, `deploy.sh`,
  `backup.sh` — see `server/README.md`.
- **`src-tauri/src/sync_client.rs` / `sync.rs`** — HTTPS transport. The webview never talks to the server;
  Rust forwards the frontend's request verbatim and returns the JSON (same "Rust doesn't interpret" rule as the
  tray). `sync_client.rs` has no Tauri dependency so it can be compiled and tested standalone.
- **`src/sync/merge.ts`, `engine.ts`, `src/hooks/useSync.ts`** — collect, push/pull, merge. Pure, injected
  dependencies, covered end to end in `tests/sync.test.ts` (two simulated Macs against the real server code).

Rules that the code depends on:

- **Conflicts are record-level last-writer-wins on `updatedAt`**; a tombstone is just another write. Ties are
  broken by the canonical JSON of the content so every party picks the same winner. Two Macs editing different
  fields of one task concurrently lose one edit — accepted for single-user use.
- **"What changed" uses the server's `seq`, never device clocks.** Each accepted write gets the next `seq`; the
  client keeps a `cursor`. Clocks only decide conflicts, which is why the settings dialog warns on clock skew.
- **Pushes use a watermark** (`sync.pushedUntil` = start time of the last *completed* sync) minus a 60 s
  overlap. Re-pushing is harmless because the server ignores writes that aren't newer.
- **`serverId`** is random per server database. When it changes (server rebuilt), the engine restarts the round
  from scratch (`syncFrom(deps, true)`) — it can't rely on resetting the store first, because React applies
  `update` only on the next render.
- **Invariant repair happens only on the server** (`invariants.ts`): two open check-ins or focus timers (two
  Macs clocked in offline) → keep the latest-started one, close the others at its start. The repair's
  `updatedAt` is `max(now, involved + 1ms)`, or a Mac with a fast clock would win the old open version back.
- **Mass-delete guard:** if one sync would tombstone more than `MASS_DELETE_THRESHOLD` (20) visible local records,
  the user is asked first; declining applies nothing, keeps the cursor, and pauses auto-sync until a manual sync.
- **Never apply partial garbage:** the engine rejects the whole response if any record fails `parseSyncRecord`.
- **Merges that change nothing return the same `store` object.** `useSync` re-syncs 5 s after `tasks` /
  `timeEntries` / `checkins` change; a no-op merge that produced a new object would loop forever.

Security: the server is HTTPS-only with a self-made CA (`gen-cert.sh` writes its own OpenSSL config — the
system default adds `CA:TRUE` to `req -x509` certs, which rustls rejects as a server cert). The client uses
reqwest's `tls_certs_only([pasted CA])`, which disables every built-in root, so only certificates from that CA
pass. Re-running `gen-cert.sh` reuses the CA and re-issues the leaf, so Macs need no reconfiguration. The token
is ≥ 32 chars, compared with `timingSafeEqual` over SHA-256 digests, rate-limited per IP, never logged, and on
macOS stored in the Keychain (`security-framework`); `sync_get_config` reports only `hasToken`, never the value.
Unsigned builds get a new code signature each release, so macOS may ask once to allow Keychain access after
an update.

Overlapping check-ins (typically two Macs' histories merged on the first sync) are not auto-resolved:
`findOverlappingCheckinIds()` marks them 时间重叠 in the Time page history for the user to fix.

What is **not** verified locally: `sync.rs`'s macOS Keychain branch and the real `#[tauri::command]` expansion
only compile on macOS CI. The other sync Rust code was compiled standalone against the real dependencies.

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
- Form controls size by **height**, not padding: `--control-height` (42px, `.field`) and
  `--control-height-sm` (40px, `.resource-row`). A native `<select>` renders at its own platform
  `menulist` size and ignores padding, so it drifts out of line with an `<input>` beside it — every select
  therefore sets `appearance: none` plus a `--select-chevron` background (which has a dark-mode override).
  Style a new select with these variables rather than padding, or it won't line up.
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

The runner is pinned to `macos-26`, the newest GA arm64 image. GitHub supports only the two newest macOS images,
so this label will be retired eventually, as `macos-14` was on 2026-11-02. macOS 27 has no `macos-27` label:
from Xcode 27 on, GitHub names images by Xcode version (`xcode-27`), and that image was still marked preview
when this was written — not suitable for the release pipeline. When a runner image is retired, the job is **cancelled
within seconds with no runner assigned and no steps run** — it looks like a flaky cancel, not a build error.
The cause shows up only in the check-run annotation (`The configuration '…' is not supported`), so check that
before retrying.
