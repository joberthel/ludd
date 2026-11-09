import fs from 'node:fs'
import path from 'node:path'

export interface SimulatedStatus {
  phpstan: 'ok' | 'fail'
  phpunit: 'ok' | 'fail'
}

export function writeStatus(dir: string, status: SimulatedStatus): void {
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status), 'utf-8')
}

function writePhpstanScript(dir: string): void {
  const script = [
    `const fs = require('fs');`,
    `const path = require('path');`,
    `const status = JSON.parse(fs.readFileSync(path.join(__dirname, 'status.json'), 'utf8'));`,
    `if (status.phpstan === 'fail') {`,
    `  const report = { errors: [{ message: 'Call to undefined method Auth::verify()', line: 15 }] };`,
    `  process.stdout.write(JSON.stringify(report));`,
    `  process.exit(1);`,
    `}`,
    `process.exit(0);`,
  ].join('\n')
  fs.writeFileSync(path.join(dir, 'phpstan.cjs'), script, 'utf-8')
}

function writePhpunitScript(dir: string): void {
  const script = [
    `const fs = require('fs');`,
    `const path = require('path');`,
    `const status = JSON.parse(fs.readFileSync(path.join(__dirname, 'status.json'), 'utf8'));`,
    `if (status.phpunit === 'fail') {`,
    `  process.stdout.write('PHPUnit 10.5.0\\nFAILURES!\\nTests: 2, Failures: 1.\\nAssertion failed.');`,
    `  process.exit(1);`,
    `}`,
    `process.exit(0);`,
  ].join('\n')
  fs.writeFileSync(path.join(dir, 'phpunit.cjs'), script, 'utf-8')
}

function writeCommitScript(dir: string): void {
  const script = [
    `const fs = require('fs');`,
    `const path = require('path');`,
    `const msg = process.argv[2] || 'empty';`,
    `fs.appendFileSync(path.join(__dirname, 'commits.log'), msg + '\\n');`,
    `process.exit(0);`,
  ].join('\n')
  fs.writeFileSync(path.join(dir, 'commit.cjs'), script, 'utf-8')
}

function writeGitScripts(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'git-status.cjs'),
    `process.stdout.write('M src/auth.ts\\n'); process.exit(0);`,
    'utf-8',
  )
  fs.writeFileSync(
    path.join(dir, 'git-log.cjs'),
    `process.stdout.write('a1b2c3d feat(auth): complete slice with clean review\\n'); process.exit(0);`,
    'utf-8',
  )
  fs.writeFileSync(
    path.join(dir, 'push-branch.cjs'),
    `const fs = require('fs'); const path = require('path'); fs.writeFileSync(path.join(__dirname, 'push.log'), 'pushed\\n'); process.exit(0);`,
    'utf-8',
  )
}

export function setupSimulatedCommands(dir: string): void {
  writePhpstanScript(dir)
  writePhpunitScript(dir)
  writeCommitScript(dir)
  writeGitScripts(dir)
  writeStatus(dir, { phpstan: 'ok', phpunit: 'fail' })
}
