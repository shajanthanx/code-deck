'use strict';
// Cut a production release.
//
// Flow: bump the version → commit → create a v<version> git tag → push.
// Pushing the tag triggers the GitHub Actions "Release" workflow, which builds
// the NSIS installer and publishes it (installer + latest.yml + blockmap) to the
// public code-deck-releases repo. Installed apps then auto-detect and update.
//
// Usage (from the project root, on a CLEAN working tree):
//   npm run release              patch   1.0.0 -> 1.0.1  (default)
//   npm run release:minor        minor   1.0.0 -> 1.1.0
//   npm run release:major        major   1.0.0 -> 2.0.0
//   npm run release -- 1.4.2     set an exact version
//   ...add --no-push to bump + commit + tag locally but not push (inspect first).
//
// This uses `npm version`, which updates package.json AND package-lock.json,
// creates the commit, and creates the tag atomically.

const { execSync } = require('child_process');

const argv = process.argv.slice(2);
const noPush = argv.includes('--no-push');
const arg = (argv.find((a) => !a.startsWith('--')) || 'patch').trim();

const KINDS = ['patch', 'minor', 'major'];
const isExact = /^\d+\.\d+\.\d+$/.test(arg);
if (!KINDS.includes(arg) && !isExact) {
  console.error(`Unknown argument "${arg}". Use: patch | minor | major | x.y.z`);
  process.exit(1);
}

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
}
function runInherit(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

// --- preconditions -------------------------------------------------------
try {
  run('git rev-parse --is-inside-work-tree');
} catch {
  console.error('Not a git repository. Run `git init` and set an `origin` remote first.');
  process.exit(1);
}

const dirty = run('git status --porcelain');
if (dirty) {
  console.error('\nWorking tree is not clean. Commit or stash your changes before releasing:\n');
  console.error(dirty + '\n');
  process.exit(1);
}

let branch = 'main';
try { branch = run('git rev-parse --abbrev-ref HEAD') || 'main'; } catch { /* keep default */ }

// --- bump + commit + tag -------------------------------------------------
const versionArg = isExact ? arg : arg; // npm version accepts patch|minor|major|x.y.z
console.log(`\n> Bumping version (${versionArg}) and tagging…\n`);
runInherit(`npm version ${versionArg} -m "chore(release): v%s"`);

const pkg = require('../package.json');
const newVersion = pkg.version;
const tag = `v${newVersion}`;

// --- push ----------------------------------------------------------------
if (noPush) {
  console.log(`\n✓ Created commit and tag ${tag} locally (not pushed).`);
  console.log(`  Push when ready:\n    git push origin ${branch} && git push origin ${tag}\n`);
  process.exit(0);
}

console.log(`\n> Pushing ${branch} and ${tag}…\n`);
try {
  runInherit(`git push origin ${branch}`);
  runInherit(`git push origin ${tag}`);
} catch (e) {
  console.error('\nPush failed. Your commit + tag exist locally; push manually:');
  console.error(`  git push origin ${branch} && git push origin ${tag}\n`);
  process.exit(1);
}

console.log(`\n✓ Released ${tag}.`);
console.log('  CI is now building & publishing the installer:');
console.log('    Actions:  https://github.com/shajanthanx/code-deck/actions');
console.log('    Release:  https://github.com/shajanthanx/code-deck-releases/releases');
console.log('  Installed apps will pick up the update within a few hours (or on next launch).\n');
