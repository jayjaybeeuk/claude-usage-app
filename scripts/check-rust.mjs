#!/usr/bin/env node
// Preflight check for scripts that shell out to cargo (tauri dev/build, cargo test).
// Without this, a missing cargo surfaces as an opaque
// "failed to run 'cargo metadata' ... No such file or directory" from the Tauri CLI.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const cargoOnPath = spawnSync('cargo', ['--version'], { stdio: 'ignore', shell: false });
if (!cargoOnPath.error && cargoOnPath.status === 0) {
  process.exit(0);
}

const cargoBin = join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');

console.error('\n✖ Rust toolchain check failed: `cargo` was not found on your PATH.\n');

if (existsSync(cargoBin)) {
  console.error(`Rust IS installed (found ${cargoBin}) but ~/.cargo/bin is not on this shell's PATH.`);
  if (process.platform === 'win32') {
    console.error('Restart your terminal so the rustup installer\'s PATH changes take effect.');
  } else {
    console.error('Fix for the current shell:\n');
    console.error('    source "$HOME/.cargo/env"\n');
    console.error('If this recurs in every new terminal, a shell profile (e.g. ~/.zprofile) is');
    console.error('probably overwriting PATH after ~/.zshenv sets it — make sure any');
    console.error('`export PATH=...` line ends with `:$PATH`.');
  }
} else {
  console.error('Rust does not appear to be installed. Install the stable toolchain from');
  console.error('https://rustup.rs (this app is built with Tauri v2, which compiles a Rust backend).');
}

console.error('');
process.exit(1);
