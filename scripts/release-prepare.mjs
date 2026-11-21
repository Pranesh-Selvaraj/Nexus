#!/usr/bin/env node
/**
 * Prepare a release: verify the changelog section, bump every workspace
 * version, and print the tag command. It never commits, tags or pushes.
 *
 *   pnpm release:prepare 0.4.15
 *   pnpm release:prepare 0.4.15 --dry-run
 *
 * The repository has four versioned package.json files that must agree, and a
 * tag is only allowed when CHANGELOG.md already carries its section — the
 * release workflow extracts that section as the GitHub Release body and fails
 * without it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PACKAGES = [
  'package.json',
  'apps/backend/package.json',
  'apps/frontend/package.json',
  'packages/contracts/package.json',
];

const [version, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: pnpm release:prepare <major.minor.patch> [--dry-run]');
  process.exit(1);
}

const changelog = readFileSync('CHANGELOG.md', 'utf8');
const section = new RegExp(
  `^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`,
  'm',
);
if (!section.test(changelog)) {
  const unreleased = /^## \[Unreleased\]/m.test(changelog);
  console.error(
    `CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section.` +
      (unreleased
        ? '\nRename the [Unreleased] heading to that exact form first.'
        : '\nWrite the section first — it becomes the published release body.'),
  );
  process.exit(1);
}

for (const file of PACKAGES) {
  const path = resolve(file);
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  const previous = pkg.version;
  pkg.version = version;
  if (!dryRun) writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(
    `${dryRun ? 'would set' : 'set'} ${file}: ${previous} -> ${version}`,
  );
}

console.log(`
Next:
  pnpm install --lockfile-only
  git add CHANGELOG.md package.json apps/backend/package.json apps/frontend/package.json packages/contracts/package.json
  git commit -m "chore(release): ${version}"
  git tag -a v${version} -m "Nexus v${version}"
  git push origin main v${version}
`);
