/**
 * 打包并运行 md-roundtrip 回归测试：
 *   1. esbuild 打包 run-test.ts（obsidian → mocks/obsidian.ts）
 *   2. node 执行产物，断言失败时以非零码退出
 * 运行：node scratch/md-roundtrip/build-test.mjs
 */
import { build } from 'esbuild';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const mockPath = path.join(dir, 'mocks', 'obsidian.ts');
const outfile = path.join(dir, 'run-test.cjs');

await build({
	entryPoints: [path.join(dir, 'run-test.ts')],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	alias: { obsidian: mockPath },
	outfile,
	logLevel: 'warning',
});

execFileSync(process.execPath, [outfile], { stdio: 'inherit' });
