#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function cmdExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function log(message) {
  console.log(message);
}

function warn(message) {
  console.warn(message);
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(projectRoot, 'app', '.env');

log('------------------------------------------------------------');
log('Vectraspace npm install complete.');
log('Next steps:');
log('  1) Ensure Docker is installed and running.');
log('  2) Run `vectraspace onboard` to configure app settings.');
log('  3) Run `vectraspace setup` to validate and build the containers.');
log('  4) Run `vectraspace up` or `vectraspace start`.');
log('');

if (!cmdExists('docker')) {
  warn('Warning: Docker was not detected on PATH. You will need Docker before running Vectraspace.');
}

if (!existsSync(envPath)) {
  warn('Note: app/.env was not found. `vectraspace onboard` will create it from app/.env.example.');
}

log('------------------------------------------------------------');
