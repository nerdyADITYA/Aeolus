import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('JavaScript only (project requirement: no TypeScript)', () => {
  it('has no .ts/.tsx files in src', () => {
    expect(walk('src').filter((f) => /\.(ts|tsx|mts|cts)$/.test(f))).toEqual([]);
  });
  it('does not depend on TypeScript', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => d === 'typescript' || d.startsWith('@types/') || d === 'typescript-eslint')).toEqual([]);
  });
  it('only uses .js, .jsx and .css source files (plus .json test fixtures)', () => {
    const files = walk('src');
    const exts = new Set(files.map((f) => f.split('.').pop()));
    expect([...exts].filter((e) => !['js', 'jsx', 'css', 'json'].includes(e))).toEqual([]);
    const posix = (f) => f.split(String.fromCharCode(92)).join('/');
    expect(files.filter((f) => f.endsWith('.json') && !posix(f).includes('/test/fixtures/'))).toEqual([]);   // JSON only as test data
  });
});
