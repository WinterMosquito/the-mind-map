/**
 * 图片/系统应用工具：移除节点图片、用系统默认应用打开库内文件。
 * （节点附件/回收等旧能力已随专有格式支持删除；wikilink 悬停见 view-wikilink）
 */
import { App, FileSystemAdapter, Notice, Platform, TFile } from 'obsidian';
import { createSetNodeImageOptions } from './images';
import { t, type Language } from './i18n';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapView } from './view';

/** 单独移除节点图片（不影响节点与其他数据） */
export function removeNodeImage(view: MindMapView, node: MindMapNode): void {
	view.mindMap?.execCommand(
		'SET_NODE_IMAGE',
		node,
		createSetNodeImageOptions(null),
	);
}

/**
 * 用系统默认应用打开库内文件（仅桌面端；移动端无系统应用入口，仅提示）。
 * 官方 API 说明：FileSystemAdapter 是 Obsidian 公开类（obsidian.d.ts），
 * 用 instanceof 收窄 DataAdapter，避免依赖类型断言。
 */
export function openFileWithSystemApp(
	app: App,
	file: TFile,
	lang: Language,
): void {
	if (Platform.isDesktopApp) {
		try {
			const adapter = app.vault.adapter;
			// 桌面端适配器即 FileSystemAdapter，提供 getFullPath（绝对路径）
			if (adapter instanceof FileSystemAdapter) {
				const nodeRequire = require as (id: string) => unknown;
				const { shell } = nodeRequire('electron') as {
					shell: { openPath(path: string): Promise<string> };
				};
				void shell.openPath(adapter.getFullPath(file.path));
				return;
			}
		} catch (error) {
			console.error('调用系统默认应用打开失败:', file.path, error);
		}
	}
	new Notice(t(lang, 'common.cannotOpen'));
}
