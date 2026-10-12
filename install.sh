#!/usr/bin/env bash
# Installs or upgrades homelab_manager as a systemd service.
#
#   curl -fsSL https://github.com/narrativityy/homelab_manager/releases/latest/download/install.sh | sudo bash
#
# Options:
#   --host ADDR         address to listen on (skips the prompt)
#   --port PORT         port to listen on (default 7575)
#   --archive FILE      install from a local release archive instead of downloading
#   --import-data DIR   copy an existing database from DIR on a fresh install
#   --docker            let the dashboard manage Docker containers (root-equivalent access)
#   --no-docker         do not grant Docker access, and remove it if previously granted
#   --stacks-dir DIR    also list Compose stacks found in DIR's sub-directories, even when not running
#   --yes               never prompt; use defaults for anything not given
set -euo pipefail

REPO="narrativityy/homelab_manager"
NAME="homelab_manager"
APP_DIR="/opt/$NAME"
DATA_DIR="/var/lib/$NAME"
CONF_DIR="/etc/$NAME"
CONF_FILE="$CONF_DIR/config.env"
UNIT_FILE="/etc/systemd/system/$NAME.service"
SUDOERS_FILE="/etc/sudoers.d/$NAME"
DEFAULT_PORT=7575

host="" port="" archive="" import_data="" assume_yes=0 docker_access="" stacks_dir=""

say() { printf '%s\n' "$*"; }
step() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --host) host="${2:?--host needs a value}"; shift 2 ;;
    --port) port="${2:?--port needs a value}"; shift 2 ;;
    --archive) archive="${2:?--archive needs a value}"; shift 2 ;;
    --import-data) import_data="${2:?--import-data needs a value}"; shift 2 ;;
    --stacks-dir) stacks_dir="${2:?--stacks-dir needs a value}"; shift 2 ;;
    --docker) docker_access=yes; shift ;;
    --no-docker) docker_access=no; shift ;;
    --yes | -y) assume_yes=1; shift ;;
    -h | --help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "Run this as root (use sudo)."
[ -d /run/systemd/system ] || die "This installer needs a Linux system running systemd."
systemctl_bin="$(command -v systemctl)" || die "systemctl not found."

case "$(uname -m)" in
  x86_64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) die "Unsupported architecture: $(uname -m). Supported: x86_64, arm64." ;;
esac

upgrade=0
[ -f "$CONF_FILE" ] && upgrade=1

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ---- get the release ----

if [ -z "$archive" ]; then
  command -v curl >/dev/null || die "curl is required to download the release."
  asset="$NAME-linux-$arch.tar.gz"
  base="https://github.com/$REPO/releases/latest/download"
  step "Downloading $asset"
  curl -fSL --progress-bar -o "$tmp/$asset" "$base/$asset"
  curl -fsSL -o "$tmp/$asset.sha256" "$base/$asset.sha256"
  (cd "$tmp" && sha256sum -c --quiet "$asset.sha256") || die "Checksum mismatch; the download is corrupt or was tampered with."
  archive="$tmp/$asset"
fi
[ -f "$archive" ] || die "Archive not found: $archive"

step "Unpacking"
tar -xzf "$archive" -C "$tmp"
[ -x "$tmp/$NAME/runtime/node" ] || die "Archive does not look like a $NAME release."
"$tmp/$NAME/runtime/node" --version >/dev/null 2>&1 || die "The bundled runtime cannot run on this system (wrong architecture or a very old distribution)."
version="$("$tmp/$NAME/runtime/node" -p "require('$tmp/$NAME/package.json').version")"

# ---- choose where to listen (fresh installs only) ----

if [ "$upgrade" -eq 0 ]; then
  port="${port:-$DEFAULT_PORT}"
  if [ -z "$host" ]; then
    host="127.0.0.1"
    if [ "$assume_yes" -eq 0 ] && [ -r /dev/tty ]; then
      options=("127.0.0.1|This machine only (most private; reach it through an SSH tunnel)")
      ts_ip="$(command -v tailscale >/dev/null && tailscale ip -4 2>/dev/null | head -n1 || true)"
      [ -n "$ts_ip" ] && options+=("$ts_ip|Tailscale (devices on your tailnet)")
      lan_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n1 || true)"
      [ -n "$lan_ip" ] && options+=("$lan_ip|Local network (anyone on your LAN can reach the login page)")
      say ""
      say "Where should the dashboard listen?"
      for i in "${!options[@]}"; do
        printf '  %d) %-15s %s\n' "$((i + 1))" "${options[$i]%%|*}" "${options[$i]#*|}"
      done
      printf 'Choose [1]: '
      read -r choice </dev/tty || choice=""
      choice="${choice:-1}"
      if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "${#options[@]}" ]; then
        host="${options[$((choice - 1))]%%|*}"
      else
        die "Not a valid choice: $choice"
      fi
    fi
  fi
fi

# ---- install ----

if ! id "$NAME" >/dev/null 2>&1; then
  step "Creating the $NAME system user"
  useradd --system --user-group --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$NAME"
fi

if [ "$upgrade" -eq 1 ]; then
  step "Upgrading to $version"
  systemctl stop "$NAME.service" 2>/dev/null || true
else
  step "Installing $version"
fi

rm -rf "$APP_DIR"
mv "$tmp/$NAME" "$APP_DIR"
chown -R root:root "$APP_DIR"
chmod -R go-w "$APP_DIR"
ln -sf "$APP_DIR/bin/$NAME" "/usr/local/bin/$NAME"

install -d -m 0700 -o "$NAME" -g "$NAME" "$DATA_DIR"
if [ "$upgrade" -eq 0 ] && [ -n "$import_data" ]; then
  [ -f "$import_data/$NAME.db" ] || die "No $NAME.db found in $import_data"
  step "Importing existing data from $import_data"
  # Checkpoint first so the single .db file holds everything, then copy just that file.
  "$APP_DIR/runtime/node" -e "new (require('node:sqlite').DatabaseSync)(process.argv[1]).exec('PRAGMA wal_checkpoint(TRUNCATE)')" "$import_data/$NAME.db" 2>/dev/null || true
  install -m 0600 -o "$NAME" -g "$NAME" "$import_data/$NAME.db" "$DATA_DIR/$NAME.db"
fi

if [ "$upgrade" -eq 0 ]; then
  install -d -m 0755 "$CONF_DIR"
  umask 027
  cat > "$CONF_FILE" <<CONF
# homelab_manager settings. Restart the service after editing:
#   sudo systemctl restart $NAME
HLM_HOST=$host
HLM_PORT=$port
CONF
  umask 022
  chown root:"$NAME" "$CONF_FILE"
fi

# Docker access is root-equivalent, so it is only granted when asked for.
if getent group docker >/dev/null; then
  if [ -z "$docker_access" ] && [ "$upgrade" -eq 0 ] && [ "$assume_yes" -eq 0 ] && [ -r /dev/tty ]; then
    say ""
    say "Docker is installed. The dashboard can list, start, stop and restart containers and show their logs."
    say "This needs membership of the docker group, which is equivalent to root access on this machine."
    printf 'Allow the dashboard to manage Docker? [y/N] '
    read -r answer </dev/tty || answer=""
    case "$answer" in y | Y | yes) docker_access=yes ;; *) docker_access=no ;; esac
  fi
  if [ "$docker_access" = yes ]; then
    step "Granting Docker access"
    usermod -aG docker "$NAME"
  elif [ "$docker_access" = no ] && id -nG "$NAME" | tr ' ' '\n' | grep -qx docker; then
    step "Removing Docker access"
    gpasswd -d "$NAME" docker >/dev/null
  fi
elif [ "$docker_access" = yes ]; then
  say "Note: --docker was given but Docker is not installed; skipping."
fi

if [ -n "$stacks_dir" ]; then
  [ -d "$stacks_dir" ] || die "Stacks directory not found: $stacks_dir"
  stacks_dir="$(cd "$stacks_dir" && pwd)"
  sed -i '/^HLM_STACKS_DIR=/d' "$CONF_FILE"
  printf 'HLM_STACKS_DIR=%s\n' "$stacks_dir" >> "$CONF_FILE"
  if ! runuser -u "$NAME" -- test -r "$stacks_dir"; then
    say "Note: the $NAME user cannot read $stacks_dir yet, so stacks there cannot be brought up or updated"
    say "      from the dashboard until you give it read access."
  fi
fi

sed "s|@SYSTEMCTL@|$systemctl_bin|g" "$APP_DIR/packaging/$NAME.service" > "$UNIT_FILE"

# Lets the dashboard restart, stop, enable and disable its own service, and nothing else.
if command -v visudo >/dev/null && [ -d /etc/sudoers.d ]; then
  sed "s|@SYSTEMCTL@|$systemctl_bin|g" "$APP_DIR/packaging/sudoers" > "$tmp/sudoers"
  if visudo -cf "$tmp/sudoers" >/dev/null; then
    install -m 0440 -o root -g root "$tmp/sudoers" "$SUDOERS_FILE"
  else
    say "Warning: could not validate the sudo rule; service controls in the dashboard will be unavailable."
  fi
else
  say "Note: sudo is not installed, so service controls in the dashboard will be unavailable."
fi

step "Starting the service"
systemctl daemon-reload
if [ "$upgrade" -eq 1 ]; then
  # Preserve the user's start-on-boot choice across upgrades.
  systemctl start "$NAME.service"
else
  systemctl enable --quiet --now "$NAME.service"
fi

# shellcheck disable=SC1090
. "$CONF_FILE"
# A wildcard address cannot be opened or probed directly.
case "$HLM_HOST" in
  0.0.0.0 | ::) probe_host="127.0.0.1"; shown_host="$(hostname)" ;;
  *) probe_host="$HLM_HOST"; shown_host="$HLM_HOST" ;;
esac
url="http://$shown_host:$HLM_PORT"
ready=0
for _ in $(seq 1 30); do
  if "$APP_DIR/runtime/node" -e "fetch('http://$probe_host:$HLM_PORT/api/auth/status').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.5
done

say ""
if [ "$ready" -eq 0 ]; then
  say "The service was installed but is not answering at $url yet."
  say "Check it with:  sudo $NAME logs"
  exit 1
fi

say "homelab_manager $version is running at $url"
setup_link="$("/usr/local/bin/$NAME" setup-link 2>/dev/null || true)"
if [ -n "$setup_link" ]; then
  say ""
  say "Create your admin account here:"
  say "  $setup_link"
fi
if [ "$HLM_HOST" = "127.0.0.1" ]; then
  say ""
  say "It listens on this machine only. From another computer, tunnel in with:"
  say "  ssh -L $HLM_PORT:127.0.0.1:$HLM_PORT <user>@<this-server>   then open http://localhost:$HLM_PORT"
elif command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
  say ""
  say "ufw is active. If the page does not load, allow the port, for example:"
  say "  sudo ufw allow $HLM_PORT/tcp"
fi
say ""
say "Manage it with:  $NAME status | logs | restart | update | uninstall"
