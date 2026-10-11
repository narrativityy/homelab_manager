# Security policy

homelab_manager manages a server and can hold root-equivalent access to it (for example through Docker), so
security reports are taken seriously.

## Reporting a vulnerability

Please report it privately through GitHub: go to the repository's **Security** tab and choose
[**Report a vulnerability**](https://github.com/narrativityy/homelab_manager/security/advisories/new).
Do not open a public issue.

Include what you found, how to reproduce it, the version or commit, and what an attacker could do with it.
This is a single-maintainer project, so responses are best effort. Please allow a reasonable amount of time
for a fix before disclosing publicly.

## Supported versions

The project is pre-release. Fixes are made on `main` and, once releases exist, in the latest release only.

## What the dashboard is trusted with

Knowing the intended boundaries helps tell a vulnerability from a design decision.

- The service runs as a dedicated unprivileged user, `homelab_manager`.
- Its sudo rules permit only restart, stop, enable and disable of its own systemd unit.
- If the administrator grants Docker access, the service user joins the `docker` group. That is equivalent
  to root on the host, and anyone who can sign in to the dashboard can then control containers.
- It serves plain HTTP and listens on localhost unless configured otherwise. Exposing it directly to the
  internet is not a supported setup.

Anything that lets someone act without a valid session, exceed the grants above, or reach the dashboard's
data from another local user is in scope.
