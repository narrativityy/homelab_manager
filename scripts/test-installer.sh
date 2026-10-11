#!/usr/bin/env bash
# Exercises install.sh end to end inside a throwaway systemd container:
# fresh install, service controls, upgrade, Docker access options and uninstall.
# Needs Docker and a release archive in dist/ (run scripts/build-release.sh first).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

IMAGE="${HLM_TEST_IMAGE:-ubuntu:24.04}"
NAME="hlm-installer-test-$$"
archive="$(ls dist/homelab_manager-linux-*.tar.gz | head -n1)"
[ -f "$archive" ] || { echo "No release archive in dist/; run scripts/build-release.sh first." >&2; exit 1; }

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> Building a systemd test image from $IMAGE"
docker build -q -t hlm-installer-test - >/dev/null <<DOCKERFILE
FROM $IMAGE
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq systemd systemd-sysv sudo iproute2 curl ca-certificates >/dev/null && rm -rf /var/lib/apt/lists/*
CMD ["/sbin/init"]
DOCKERFILE

docker run -d --name "$NAME" --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw -v "$PWD/dist:/rel:ro" hlm-installer-test >/dev/null
for _ in $(seq 1 30); do
  docker exec "$NAME" systemctl is-system-running 2>/dev/null | grep -qE 'running|degraded' && break
  sleep 1
done

docker exec -i -e ARCHIVE="/rel/$(basename "$archive")" "$NAME" bash -s <<'INNER'
set -euo pipefail
B=http://127.0.0.1:7575
C=/tmp/cookies
PW='correct horse battery'
json() { curl -fsS -b $C -c $C -H 'Content-Type: application/json' "$@"; }
check() { if eval "$2"; then echo "  ok   $1"; else echo "  FAIL $1"; exit 1; fi; }
wait_up() { for _ in $(seq 1 60); do curl -fsS -o /dev/null "$1/api/auth/status" 2>/dev/null && return 0; sleep 0.5; done; return 1; }

echo "==> Fresh install"
bash /rel/install.sh --archive "$ARCHIVE" --yes >/tmp/install.log 2>&1 || { cat /tmp/install.log; exit 1; }
check "service is active" "systemctl is-active -q homelab_manager"
check "service is enabled at boot" "systemctl is-enabled -q homelab_manager"
check "runs as the service user" "[ \"\$(systemctl show -p User --value homelab_manager)\" = homelab_manager ]"
check "data directory is private" "[ \"\$(stat -c '%a %U' /var/lib/homelab_manager)\" = '700 homelab_manager' ]"
check "program files are root-owned" "[ \"\$(stat -c '%U' /opt/homelab_manager/server/src/index.js)\" = root ]"
check "sudoers file is valid" "visudo -cf /etc/sudoers.d/homelab_manager >/dev/null"

echo "==> Setup"
link="$(homelab_manager setup-link)"
json -d "{\"token\":\"${link##*setup=}\",\"username\":\"admin\",\"password\":\"$PW\"}" $B/api/auth/setup >/dev/null
check "setup-link refuses once an account exists" "! homelab_manager setup-link >/dev/null 2>&1"
check "dashboard reports it is managed and controllable" "json $B/api/service | grep -q '\"managed\":true.*\"canControl\":true'"

echo "==> Service controls"
json -d '{"enabled":false}' $B/api/service/boot >/dev/null
check "start on boot can be turned off" "! systemctl is-enabled -q homelab_manager"
json -d '{"enabled":true}' $B/api/service/boot >/dev/null
check "start on boot can be turned on" "systemctl is-enabled -q homelab_manager"
before="$(json $B/api/service | grep -o '"startedAt":[0-9]*')"
json -X POST $B/api/service/restart >/dev/null
sleep 2; wait_up $B
check "restart starts a new process" "[ \"\$(json $B/api/service | grep -o '\"startedAt\":[0-9]*')\" != \"$before\" ]"
check "session survives a restart" "json $B/api/auth/status | grep -q '\"username\":\"admin\"'"
check "stop rejects a wrong password" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -b $C -H 'Content-Type: application/json' -d '{\"password\":\"nope\"}' $B/api/service/stop)\" = 401 ]"
json -d "{\"password\":\"$PW\"}" $B/api/service/stop >/dev/null
sleep 2
check "stop with the right password stops the service" "! systemctl is-active -q homelab_manager"

echo "==> Privilege scope"
check "service user cannot control other units" "! sudo -u homelab_manager sudo -n /usr/bin/systemctl stop systemd-journald.service 2>/dev/null"
check "service user cannot run arbitrary commands" "! sudo -u homelab_manager sudo -n /usr/bin/id 2>/dev/null"

echo "==> Upgrade"
sed -i 's/^HLM_PORT=.*/HLM_PORT=7576/' /etc/homelab_manager/config.env
systemctl disable -q homelab_manager
bash /rel/install.sh --archive "$ARCHIVE" --yes >/tmp/upgrade.log 2>&1 || { cat /tmp/upgrade.log; exit 1; }
B=http://127.0.0.1:7576
check "upgrade keeps the configured port" "wait_up $B"
check "upgrade keeps the start-on-boot choice" "! systemctl is-enabled -q homelab_manager"
check "upgrade keeps the account" "json $B/api/auth/status | grep -q '\"username\":\"admin\"'"

mkdir -p /srv/stacks
bash /rel/install.sh --archive "$ARCHIVE" --yes --stacks-dir /srv/stacks >/dev/null 2>&1
check "--stacks-dir is written to the config" "grep -qx 'HLM_STACKS_DIR=/srv/stacks' /etc/homelab_manager/config.env"
check "the port setting survives it" "grep -qx 'HLM_PORT=7576' /etc/homelab_manager/config.env && wait_up $B"

echo "==> Docker access"
check "Docker reported as not installed" "json $B/api/docker | grep -q '\"reason\":\"not-installed\"'"
groupadd docker
bash /rel/install.sh --archive "$ARCHIVE" --yes >/dev/null 2>&1
check "access is not granted without --docker" "! id -nG homelab_manager | grep -qw docker"
bash /rel/install.sh --archive "$ARCHIVE" --yes --docker >/dev/null 2>&1
check "--docker grants access" "id -nG homelab_manager | grep -qw docker"
bash /rel/install.sh --archive "$ARCHIVE" --yes --no-docker >/dev/null 2>&1
check "--no-docker removes access" "! id -nG homelab_manager | grep -qw docker"

echo "==> Uninstall"
homelab_manager uninstall --purge >/dev/null
for p in /opt/homelab_manager /var/lib/homelab_manager /etc/homelab_manager /etc/sudoers.d/homelab_manager /etc/systemd/system/homelab_manager.service /usr/local/bin/homelab_manager; do
  check "removed $p" "[ ! -e $p ]"
done
check "service user removed" "! id homelab_manager >/dev/null 2>&1"
echo "All installer checks passed."
INNER
