import { describe, it, expect } from 'vitest';
import { parseInstallCommand } from '../src/core/parse-command.js';

const npm = (name: string, spec?: string) => ({ ecosystem: 'npm', name, spec });

describe('parseInstallCommand', () => {
  it('parses npm install with versions and scopes', () => {
    expect(parseInstallCommand('npm install lodash@4.17.21 @types/node')).toEqual([npm('lodash', '4.17.21'), npm('@types/node', undefined)]);
  });
  it('handles npm i / add aliases, pnpm, yarn, bun, npx', () => {
    expect(parseInstallCommand('npm i -D vitest')).toEqual([npm('vitest')]);
    expect(parseInstallCommand('pnpm add -w zod@^3')).toEqual([npm('zod', '^3')]);
    expect(parseInstallCommand('yarn add react react-dom')).toEqual([npm('react'), npm('react-dom')]);
    expect(parseInstallCommand('bun add axios')).toEqual([npm('axios')]);
    expect(parseInstallCommand('npx create-next-app@latest my-app')).toEqual([npm('create-next-app', 'latest')]);
  });
  it('returns nothing for bare installs or unrelated commands', () => {
    expect(parseInstallCommand('npm install')).toEqual([]);
    expect(parseInstallCommand('npm ci')).toEqual([]);
    expect(parseInstallCommand('ls -la')).toEqual([]);
  });
  it('handles chained commands and ignores flags with values', () => {
    expect(parseInstallCommand('cd app && npm install --save-dev eslint; echo done')).toEqual([npm('eslint')]);
    expect(parseInstallCommand('npm install --registry=https://x.y foo')).toEqual([npm('foo')]);
  });
  it('skips local paths, urls and git specs', () => {
    expect(parseInstallCommand('npm install ./local ../other file:x https://a/b.tgz github:u/r')).toEqual([]);
  });
});
