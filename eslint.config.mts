import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'scratch',
		'vendor/**',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	{
		files: ['src/view-attachments.ts'],
		languageOptions: {
			globals: {
				// require('electron') 是 Obsidian 桌面插件获取系统 API 的标准做法，
				// 由 esbuild 按 CommonJS 解析，仅在 Platform.isDesktopApp 分支使用
				require: 'readonly',
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['src/modal-*.ts'],
		rules: {
			// 弹窗样式沿用原版内联样式方案（含动态值：颜色预设、字号选项等），
			// 由样式常量集中管理，故关闭静态样式类检查。
			'obsidianmd/no-static-styles-assignment': 'off',
		},
	},
);
