# homelab_manager — Claude Guide

## 1. Critical Commands

Everything runs from the root `package.json`; there is one package, not one per directory. Node.js 24 or newer
is required.

| Task            | Command                                      | Notes                                                           |
| --------------- | -------------------------------------------- | --------------------------------------------------------------- |
| Dev stack       | `npm run dev`                                | API on `:7575` (`node --watch`), Vite dev server on `:5173`     |
| Lint            | `npm run lint`                               | ESLint, whole repo                                              |
| Format          | `npm run format` / `npm run format:check`    | Prettier, whole repo including Markdown                         |
| Test            | `npm test`                                   | `node:test`; starts a real server on a temp data dir            |
| Build client    | `npm run build`                              | Vite, output in `client/dist/`                                  |
| Release archive | `./scripts/build-release.sh`                 | Output in `dist/homelab_manager-linux-<arch>.tar.gz`            |
| Installer test  | `./scripts/test-installer.sh`                | Needs Docker and a release archive; runs in a systemd container |
| Install/upgrade | `sudo ./install.sh --archive dist/<archive>` | Changes the host: service user, systemd unit, sudoers file      |

CI (`.github/workflows/ci.yml`) runs two jobs on every pull request: **"Lint, build and API tests"** (`lint`,
`format:check`, `build`, `test`) and **"Installer"** (`build-release.sh`, then `test-installer.sh`). Both are
required by branch protection on `main` — both, not just one, must stay green.

Things to know before running anything:

- The dashboard may also be **installed** on the development machine, where it already holds port 7575 and
  `/var/lib/homelab_manager`. Run a second instance with `HLM_PORT` and `HLM_DATA_DIR` set to something else,
  and stop it by the PID that owns the port, never with `pkill -f` on the server path (that also matches the
  installed service).
- `test-installer.sh` starts a privileged systemd container. Run it only when the installer, the unit, the
  sudoers template or the CLI changed; CI covers it otherwise.
- The stack tests in `test/api.test.js` bring a throwaway Compose project (`hlm-test-<pid>`) up and down on
  the host's Docker and skip themselves when Compose is not available.

## 2. Project Description

homelab_manager is a self-hosted web dashboard for managing a Linux homelab server: live system stats and
history, Docker containers, Compose stacks, and control of its own systemd service. It is built to be
downloaded and installed by other people on their own machines, so nothing may assume this developer's
server, paths or distribution.

Two parts, served as one process in production:

- **`server/`** (Node, Express 5, ESM, plain JavaScript) is the only thing that touches the system: auth and
  sessions (`auth.js`), stats sampling and history (`stats.js`, `statsWs.js`), the Docker socket (`docker.js`),
  Compose stacks (`stacks.js`), its own systemd unit (`service.js`), SQLite through `node:sqlite` (`db.js`),
  and environment-driven settings (`config.js`). It also serves the built client.
- **`client/`** (React 19, Vite, plain JavaScript) is the UI. It talks only to `/api/*` and `/ws/stats` through
  `client/src/api.js`. There is no router library and no component library; pages are in `client/src/pages/`.

Around them: `install.sh` (native systemd install and upgrade), `packaging/` (unit file and sudoers template),
`bin/homelab_manager` (the CLI), `scripts/` (release build and installer test), `test/` (API tests).

Core concepts:

- **Install layout:** code in `/opt/homelab_manager`, data in `/var/lib/homelab_manager`, settings in
  `/etc/homelab_manager/config.env`, unit `homelab_manager.service`, running as the unprivileged user
  `homelab_manager`.
- **Privilege is granted narrowly.** The service user's sudoers file allows exactly the `systemctl` commands
  for its own unit. Docker access is opt-in at install time (`--docker`) and is root-equivalent, which the UI
  and docs say out loud.
- **Configuration is `HLM_*` environment variables** (`HLM_HOST`, `HLM_PORT`, `HLM_DATA_DIR`,
  `HLM_STACKS_DIR`, ...), read once in `server/src/config.js`. The default bind is localhost.
- **First run** prints a one-time setup link to the server log; the admin account can only be created with
  that token.
- **Stacks** are discovered from container labels, an optional scan of `HLM_STACKS_DIR`, and a table of stacks
  seen before. Actions run `docker compose` as jobs, one per stack, with output streamed to the browser.

Work is tracked as GitHub issues against the `v0.1.0` milestone; the first release ships when that milestone
is done. `CHANGELOG.md` gets a line under "Unreleased" for anything a user would notice, and `README.md` is
updated in the same pull request as the feature it documents.

## 3. Hard Rules

- **Never edit, create, or delete a file without explicit approval first** — propose the change and wait for a
  yes, even for small or "obvious" fixes.
- **Never `git push` without explicit approval** — including opening, updating or merging a pull request.
  Committing locally does not need approval once the edit itself was approved.
- **Never push to `main`.** Every change goes on its own branch and through a pull request with both CI jobs
  green; pull requests are squash-merged.
- For any feature in `server/` that could reasonably get tests, **write the tests first**, confirm them with
  the user, then implement. `client/` has no test suite.
- **Ask before anything that changes the host outside the repository:** running `install.sh` or upgrading the
  installed service, SSH, firewall or network settings, file permissions, and anything destructive (disk and
  LVM operations, deleting data, removing volumes).
- **Never act on Docker resources the task did not create.** The development machine runs real services.
  Tests and experiments use their own throwaway containers and stacks and clean them up.
- **No native modules and no compile step on the install path.** Adding any dependency needs a stated reason;
  prefer the Node standard library.
- **No new privilege without asking.** Anything that widens what the service user can do (a sudoers entry, a
  group, a helper running as root) is a design decision for the user, and must be opt-in in the installer and
  stated in the UI and docs.
- **Never build a path, command or argument from browser input.** Names from the client are only matched
  against what the server discovered itself. Every `/api` route except `/api/auth` sits behind `requireAuth`.
- The test setup is settled: `node:test`, tests under `test/`, run against a real server. Don't introduce
  another test framework or reorganize existing tests.
- Don't use browser automation unless explicitly asked.

## 4. Workflow Preferences

- Ask clarifying questions before starting any complex or ambiguous task — don't guess at scope and run with
  it.
- Explain briefly what each change does and why.
- Run `npm run lint`, `npm run format:check` and `npm test` after every change, not just at the end.
- Commit as each piece is implemented: one commit per logical change, never one giant commit covering several
  unrelated things. One pull request per issue; reference the issue in it.
- The pull request title becomes the squash commit message: a short imperative sentence, such as "Add Compose
  stack management". Branches are named for what they do, such as `feat/compose-stacks` or `fix/login-lockout`.
- When two approaches are both reasonable, explain the tradeoffs and let the user pick — don't silently choose
  one.
- Never modify files outside the current task's scope without asking first, even if you notice something else
  worth fixing along the way. File an issue for it instead.
- Flag it and ask before any destructive or hard-to-reverse git operation.
- Bring up backups before adding any feature or service that holds data.

## 5. Code Style

Rules marked **(enforced)** are checked by Prettier or ESLint in CI — not negotiable. Everything else is
convention: follow it, but call it out if a case genuinely argues against it.

- Formatting is Prettier's **(enforced)**: two-space indentation, single quotes, semicolons, trailing commas,
  120-column lines. Run `npm run format` instead of formatting by hand; it also covers Markdown, JSON and YAML.
- Line endings: Unix (LF), with a final newline (`.editorconfig`).
- `no-unused-vars` is an error, function args exempt when prefixed with `_` **(enforced)**.
- React hooks rules are on in `client/` **(enforced)**.
- Plain JavaScript and ES modules everywhere: no TypeScript, no CommonJS. No prop-types.
- Server modules export a router plus the few functions other modules need; SQL is written inline with
  `db.prepare`. Errors go to the client as `{ error: '...' }` with a fitting status code.
- Client styling is plain CSS in `client/src/styles.css` using the colour tokens defined there, which cover
  light and dark themes. Don't hard-code colours.
- User-facing text is plain and specific: say what happened and what to do about it.

**Comments:** code should read clearly on its own, through naming and structure. A comment is the exception,
for code that is hard to understand just by reading it.

- Default to no comment at all.
- When one is needed, it explains **how** the code works: the mechanism, a tricky step, or a non-obvious API
  behavior. It isn't there to justify a decision, record history, or restate what plain code does.
- A brief overview (1–3 lines) is fine on bigger, important, integral or fragile functions, modules or logic.
- An issue number (e.g. `#14`) may be listed to give context.
- No rationale or design-discussion prose, no references to roadmap documents, and no commented-out code.
- Never explain a concept from the ground up; assume the reader can read the code.
