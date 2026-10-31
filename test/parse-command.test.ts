import { describe, it, expect } from 'vitest';
import { parseInstallCommand, detectBareInstall, projectDirFromCommand } from '../src/core/parse-command.js';
import type { Ecosystem } from '../src/core/types.js';

const ref = (ecosystem: Ecosystem, name: string, spec?: string) => ({ ecosystem, name, spec });
const npm = (name: string, spec?: string) => ref('npm', name, spec);

describe('parseInstallCommand: npm family', () => {
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

describe('parseInstallCommand: PyPI', () => {
  it('parses pip, pip3, python -m pip, uv, poetry, pipx', () => {
    expect(parseInstallCommand('pip install requests==2.31.0 numpy')).toEqual([ref('PyPI', 'requests', '==2.31.0'), ref('PyPI', 'numpy')]);
    expect(parseInstallCommand('pip3 install "flask>=2,<3"')).toEqual([ref('PyPI', 'flask', '>=2,<3')]);
    expect(parseInstallCommand('python -m pip install --upgrade pandas')).toEqual([ref('PyPI', 'pandas')]);
    expect(parseInstallCommand('python3 -m pip install -U pandas~=2.0')).toEqual([ref('PyPI', 'pandas', '~=2.0')]);
    expect(parseInstallCommand('uv add httpx')).toEqual([ref('PyPI', 'httpx')]);
    expect(parseInstallCommand('uv pip install "uvicorn[standard]"')).toEqual([ref('PyPI', 'uvicorn')]);
    expect(parseInstallCommand('poetry add rich@^13')).toEqual([ref('PyPI', 'rich', '^13')]);
    expect(parseInstallCommand('pipx install black')).toEqual([ref('PyPI', 'black')]);
  });
  it('normalizes names and skips requirement files, editable and local installs', () => {
    expect(parseInstallCommand('pip install Django Typing_Extensions')).toEqual([ref('PyPI', 'django'), ref('PyPI', 'typing-extensions')]);
    expect(parseInstallCommand('pip install -r requirements.txt -e . ./wheel.whl')).toEqual([]);
  });
});

describe('parseInstallCommand: crates.io and Go', () => {
  it('parses cargo add / install', () => {
    expect(parseInstallCommand('cargo add serde@1.0 tokio --features full')).toEqual([ref('crates.io', 'serde', '1.0'), ref('crates.io', 'tokio')]);
    expect(parseInstallCommand('cargo install ripgrep')).toEqual([ref('crates.io', 'ripgrep')]);
    expect(parseInstallCommand('cargo add --path ../local')).toEqual([]);
  });
  it('parses go get / install', () => {
    expect(parseInstallCommand('go get github.com/gin-gonic/gin@v1.9.1')).toEqual([ref('Go', 'github.com/gin-gonic/gin', 'v1.9.1')]);
    expect(parseInstallCommand('go install golang.org/x/tools/gopls@latest')).toEqual([ref('Go', 'golang.org/x/tools/gopls', 'latest')]);
    expect(parseInstallCommand('go get ./...')).toEqual([]);
    expect(parseInstallCommand('go get -u')).toEqual([]);
  });
});

describe('detectBareInstall', () => {
  it('detects lockfile-driven installs per ecosystem', () => {
    expect(detectBareInstall('npm install')).toBe('npm');
    expect(detectBareInstall('npm ci')).toBe('npm');
    expect(detectBareInstall('pnpm i --frozen-lockfile')).toBe('npm');
    expect(detectBareInstall('yarn')).toBe('npm');
    expect(detectBareInstall('yarn install')).toBe('npm');
    expect(detectBareInstall('bun install')).toBe('npm');
    expect(detectBareInstall('pip install -r requirements.txt')).toBe('PyPI');
    expect(detectBareInstall('uv sync')).toBe('PyPI');
    expect(detectBareInstall('poetry install')).toBe('PyPI');
    expect(detectBareInstall('cargo build')).toBe('crates.io');
    expect(detectBareInstall('go mod download')).toBe('Go');
    expect(detectBareInstall('go mod tidy')).toBe('Go');
  });
  it('returns null for named installs and unrelated commands', () => {
    expect(detectBareInstall('npm install lodash')).toBeNull();
    expect(detectBareInstall('npm test')).toBeNull();
    expect(detectBareInstall('yarn build')).toBeNull();
    expect(detectBareInstall('ls')).toBeNull();
  });
});

describe('projectDirFromCommand', () => {
  it('resolves a leading cd', () => {
    expect(projectDirFromCommand('cd app && npm install', '/root')).toBe('/root/app');
    expect(projectDirFromCommand('cd "/abs path" && npm i', '/root')).toBe('/abs path');
    expect(projectDirFromCommand('npm install', '/root')).toBe('/root');
  });
});
