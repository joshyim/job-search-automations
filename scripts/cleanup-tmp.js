#!/usr/bin/env node

// ==============================================================================
// cleanup-tmp.js - Secure Ephemeral Crawl Directory Cleaner
//
// Strictly verifies real filesystem paths to prevent directory traversal,
// sibling targeting, symlink escapes, or wildcard injection.
//
// Usage:
//   node cleanup-tmp.js [--workspace <dir>] [--file <filename>]
//   node cleanup-tmp.js [--workspace <dir>] --all
//   node cleanup-tmp.js [--workspace <dir>] --ensure-dir
//
// Exit codes:
//   0  Success
//   1  Security violation or invalid structured arguments
//   2  Filesystem operation failure
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';

function printUsage() {
  console.log('Usage: node cleanup-tmp.js [--workspace <dir>] [--file <filename>] [--all] [--ensure-dir]');
  console.log('Options:');
  console.log('  --workspace <dir>   Path to project workspace (default: current working directory)');
  console.log('  --file <filename>   Specific temporary file to delete within .job-search/tmp/');
  console.log('  --all               Remove all temporary files within .job-search/tmp/');
  console.log('  --ensure-dir        Ensure .job-search/tmp/ exists without deleting anything');
  console.log('  -h, --help          Show this help message');
}

function main() {
  const args = process.argv.slice(2);
  let workspaceDir = process.cwd();
  let targetFile = null;
  let cleanAll = false;
  let ensureDirOnly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      printUsage();
      process.exit(0);
    } else if (arg === '--workspace') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) {
        console.error('[cleanup-tmp] Error: --workspace requires a valid directory argument.');
        process.exit(1);
      }
      workspaceDir = args[++i];
    } else if (arg.startsWith('--workspace=')) {
      workspaceDir = arg.slice('--workspace='.length);
    } else if (arg === '--file') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) {
        console.error('[cleanup-tmp] Error: --file requires a filename argument.');
        process.exit(1);
      }
      targetFile = args[++i];
    } else if (arg.startsWith('--file=')) {
      targetFile = arg.slice('--file='.length);
    } else if (arg === '--all') {
      cleanAll = true;
    } else if (arg === '--ensure-dir') {
      ensureDirOnly = true;
    } else {
      console.error(`[cleanup-tmp] Error: Unexpected argument '${arg}'. Structured arguments only.`);
      process.exit(1);
    }
  }

  if (!targetFile && !cleanAll && !ensureDirOnly) {
    // Default to cleanAll if neither --file nor --ensure-dir is given
    cleanAll = true;
  }

  // 1. Resolve canonical workspace path
  const resolvedWorkspace = path.resolve(workspaceDir);
  if (!fs.existsSync(resolvedWorkspace)) {
    console.error(`[cleanup-tmp] Error: Workspace directory does not exist: ${resolvedWorkspace}`);
    process.exit(1);
  }

  const expectedTmpDir = path.join(resolvedWorkspace, '.job-search', 'tmp');

  if (ensureDirOnly) {
    fs.mkdirSync(expectedTmpDir, { recursive: true });
    console.log(`[cleanup-tmp] Directory verified: ${expectedTmpDir}`);
    process.exit(0);
  }

  if (!fs.existsSync(expectedTmpDir)) {
    // If tmp directory does not exist, nothing to clean up
    process.exit(0);
  }

  // 2. Resolve realpath of tmpDir to prevent symlink bypass of tmp itself
  let realTmpDir;
  try {
    realTmpDir = fs.realpathSync(expectedTmpDir);
  } catch (err) {
    console.error(`[cleanup-tmp] Error resolving tmp realpath: ${err.message}`);
    process.exit(2);
  }

  const tmpPrefix = realTmpDir.endsWith(path.sep) ? realTmpDir : realTmpDir + path.sep;

  // Sanity check: realTmpDir must not be root or parent workspace
  if (realTmpDir === resolvedWorkspace || !realTmpDir.includes('.job-search')) {
    console.error(`[cleanup-tmp] Error: Resolved tmp path is invalid or outside .job-search: ${realTmpDir}`);
    process.exit(1);
  }

  // 3. Handle targeted file deletion
  if (targetFile) {
    if (targetFile.includes('\0')) {
      console.error('[cleanup-tmp] Error: Null byte in filename.');
      process.exit(1);
    }

    // Resolve target path
    const resolvedTarget = path.isAbsolute(targetFile)
      ? path.resolve(targetFile)
      : path.resolve(realTmpDir, targetFile);

    const normalizedTarget = path.normalize(resolvedTarget);

    // Path containment check: normalized target must start strictly with realTmpDir + sep
    if (!normalizedTarget.startsWith(tmpPrefix) || normalizedTarget === realTmpDir) {
      console.error(`[cleanup-tmp] Security Error: Target path escapes tmp directory: '${targetFile}' -> '${normalizedTarget}'`);
      process.exit(1);
    }

    // Check if target exists
    if (!fs.existsSync(normalizedTarget)) {
      // Check if it's a broken symlink (lstat will succeed even if target doesn't exist)
      try {
        const lstat = fs.lstatSync(normalizedTarget);
        if (lstat.isSymbolicLink()) {
          fs.unlinkSync(normalizedTarget);
          console.log(`[cleanup-tmp] Removed broken symlink: ${normalizedTarget}`);
          process.exit(0);
        }
      } catch {}
      // File already gone - idempotent success
      process.exit(0);
    }

    try {
      const lstat = fs.lstatSync(normalizedTarget);
      if (lstat.isSymbolicLink()) {
        // If symlink, do NOT follow it. Remove the symlink itself safely.
        fs.unlinkSync(normalizedTarget);
        console.log(`[cleanup-tmp] Removed symlink: ${normalizedTarget}`);
      } else if (lstat.isDirectory()) {
        // Confirm directory realpath also does not escape
        const realDir = fs.realpathSync(normalizedTarget);
        if (!realDir.startsWith(tmpPrefix) || realDir === realTmpDir) {
          console.error(`[cleanup-tmp] Security Error: Subdirectory realpath escapes tmp: '${realDir}'`);
          process.exit(1);
        }
        fs.rmSync(normalizedTarget, { recursive: true, force: true });
        console.log(`[cleanup-tmp] Removed directory: ${normalizedTarget}`);
      } else {
        fs.unlinkSync(normalizedTarget);
        console.log(`[cleanup-tmp] Removed file: ${normalizedTarget}`);
      }
    } catch (err) {
      console.error(`[cleanup-tmp] Failure removing target: ${err.message}`);
      process.exit(2);
    }
  }

  // 4. Handle --all flush
  if (cleanAll) {
    try {
      const entries = fs.readdirSync(realTmpDir);
      for (const entry of entries) {
        const entryPath = path.join(realTmpDir, entry);
        const lstat = fs.lstatSync(entryPath);
        if (lstat.isSymbolicLink()) {
          fs.unlinkSync(entryPath);
        } else if (lstat.isDirectory()) {
          fs.rmSync(entryPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(entryPath);
        }
      }
      console.log(`[cleanup-tmp] Cleaned all entries in: ${realTmpDir}`);
    } catch (err) {
      console.error(`[cleanup-tmp] Failure during --all clean: ${err.message}`);
      process.exit(2);
    }
  }
}

main();
