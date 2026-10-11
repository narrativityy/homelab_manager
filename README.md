# homelab_manager

A self-hosted web dashboard for managing a Linux homelab server from the browser.

**Status: early development.** What works today:

- One-command install as a systemd service, with the Node runtime bundled (nothing to compile)
- First-run setup in the browser, protected by a one-time token
- Sign-in with a hashed password, server-side sessions and login rate limiting
- Live overview pushed over WebSocket: CPU, memory, disk, temperature, network and battery,
  each with a one-hour trend, plus storage and system details
- Seven days of stat history in SQLite
- Docker containers: state, published ports, logs, and start, stop and restart
- Settings page to restart or stop the dashboard and toggle start on boot
- Light and dark themes, usable on a phone

Planned: Compose stacks, systemd services, system logs and updates.

## Install

On a Linux server with systemd (x86-64 or ARM64):

```bash
curl -fsSL https://github.com/narrativityy/homelab_manager/releases/latest/download/install.sh | sudo bash
```

Prefer to read it first? Download `install.sh` from the latest release, look it over, then run it with `sudo bash install.sh`.

The installer asks where the dashboard should listen, starts the service, and prints a link for creating
the admin account. It listens on localhost only unless you choose otherwise. It serves plain HTTP, so do
not expose it to the internet directly; use a VPN such as Tailscale or WireGuard, or an HTTPS reverse proxy.

What it puts on the system:

| Path | Contents |
|---|---|
| `/opt/homelab_manager` | The program and its bundled Node runtime |
| `/var/lib/homelab_manager` | Database (accounts, sessions, stat history) |
| `/etc/homelab_manager/config.env` | Listen address and port |
| `/etc/systemd/system/homelab_manager.service` | The service |
| `/etc/sudoers.d/homelab_manager` | Lets the dashboard restart, stop, enable and disable its own service, nothing else |

The service runs as a dedicated `homelab_manager` user, not root.

### Docker access

Managing containers requires membership of the `docker` group, which is equivalent to root on the machine.
The installer asks before granting it. To change your answer later, re-run the installer with `--docker`
or `--no-docker`.

## Managing it

```bash
homelab_manager status        # version, state and address
sudo homelab_manager logs     # follow the log
sudo homelab_manager restart
sudo homelab_manager update   # install the latest release, keeping settings and data
sudo homelab_manager uninstall
```

To change the address or port, edit `/etc/homelab_manager/config.env` (`HLM_HOST`, `HLM_PORT`) and restart.

## Development

Requires Node.js 24 or newer.

```bash
npm install
npm run dev
```

This runs the API on port 7575 with auto-restart and the Vite dev server on port 5173, which proxies
`/api` and `/ws` to it. On first start the server prints a setup link containing a one-time token.

`./scripts/build-release.sh` builds a release archive in `dist/` for the current architecture. Test it with
`sudo ./install.sh --archive dist/homelab_manager-linux-x64.tar.gz`. Pushing a `v*` tag builds and publishes
a release for both architectures.

## Layout

```
server/src/   Express API, WebSocket stats push, SQLite (node:sqlite)
client/src/   React app (Vite)
packaging/    systemd unit and sudoers templates
bin/          the homelab_manager command
install.sh    installer and upgrader
```
