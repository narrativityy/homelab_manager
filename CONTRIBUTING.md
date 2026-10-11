# Contributing

Thanks for your interest. This is an early-stage project, so the most useful contributions right now are bug
reports, testing the installer on different distributions, and feedback on the [roadmap](https://github.com/narrativityy/homelab_manager/milestones).

## Getting set up

You need Linux and Node.js 24 or newer.

```bash
git clone https://github.com/narrativityy/homelab_manager.git
cd homelab_manager
npm install
npm run dev
```

The server prints a one-time setup link on first start. The API runs on port 7575 and the Vite dev server on
port 5173.

## Before you open a pull request

```bash
npm run lint
npm run format    # or format:check to only verify
npm test
```

If you changed `install.sh`, the systemd unit, the sudoers template or the CLI, also run the installer test.
It needs Docker and runs everything inside a throwaway container:

```bash
./scripts/build-release.sh
./scripts/test-installer.sh
```

CI runs all of the above on every pull request.

## How changes land

- Branch from `main`; name it for what it does, for example `feat/compose-stacks` or `fix/login-lockout`.
- Keep a pull request to one change, and reference the issue it addresses.
- Add a line to `CHANGELOG.md` under "Unreleased" for anything a user would notice.
- Pull requests are squash-merged, so the PR title becomes the commit message. Write it as a short imperative
  sentence: "Add Compose stack management".

## Design principles

These explain most review feedback in advance.

- **Least privilege.** The service runs as an unprivileged user. Anything that needs more gets a narrowly
  scoped grant that the installer adds only when the user asks, never a general one. A feature that needs
  root-equivalent access must say so in the UI and the docs.
- **Safe by default.** Localhost-only until the user chooses otherwise. Destructive or irreversible actions
  need confirmation; ones that take the dashboard or the server down need the password again.
- **Easy to install.** No compiler and no native modules on the default path. Think hard before adding a
  dependency.
- **Shows what applies.** Features detect what the machine has (Docker, a battery, SMART) and stay out of the
  way otherwise.

## Reporting security problems

Please do not open a public issue. See [SECURITY.md](SECURITY.md).
