import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const config = {
  version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  // Localhost by default: the dashboard is only reachable from other machines
  // when the operator explicitly binds it to a LAN or VPN address.
  host: process.env.HLM_HOST || '127.0.0.1',
  port: Number(process.env.HLM_PORT) || 7575,
  dataDir: process.env.HLM_DATA_DIR || path.join(root, 'data'),
  clientDist: path.join(root, 'client/dist'),
  // Set by the systemd unit. When absent (a dev run), the dashboard cannot manage its own service.
  systemdUnit: process.env.HLM_SYSTEMD_UNIT || null,
  systemctl: process.env.HLM_SYSTEMCTL || '/usr/bin/systemctl',
};
