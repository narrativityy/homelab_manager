# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0, minor versions may include breaking changes.

## [Unreleased]

### Added

- One-command installer that sets the dashboard up as a systemd service, with the Node runtime bundled
- `homelab_manager` command: `status`, `logs`, `setup-link`, `start`, `stop`, `restart`, `update`, `uninstall`
- First-run setup in the browser, protected by a one-time token from the server log
- Sign-in with hashed passwords, server-side sessions and login rate limiting
- Overview page: live CPU, memory, disk, temperature, network and battery, each with a one-hour trend
- Seven days of stat history
- Stacks page: Compose stacks discovered from running containers and an optional stacks directory, with up,
  update, restart, stop and down, and live command output
- Containers page: state, published ports, logs, and start, stop and restart, with opt-in Docker access
- Settings page: restart or stop the dashboard and toggle start on boot
- Light and dark themes and a phone layout
