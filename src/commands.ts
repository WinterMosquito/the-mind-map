/**
 * 用户入口注册：命令面板命令与丝带图标。
 * 生命周期（registerView、事件监听、设置面板）由 main.ts 负责。
 */
import { MarkdownView } from 'obsidian';
import { MindMapView } from './view';
import { createNewMindMap } from './creation';
import { fitMindMap } from './mindmap';
import { isMindMapMarkdownFile, openAsMindMap } from './md-open';
import { t } from './i18n';
import type TheMindMapPlugin from './main';

/** 注册全部命令面板命令与丝带图标（onload 时调用一次） */
export function registerCommands(plugin: TheMindMapPlugin): void {
	plugin.addCommand({
		id: 'create-new-mindmap',
		name: t(plugin.settings.language, 'command.createMindMap'),
		callback: () => {
			void createNewMindMap(plugin.app, plugin.settings.language);
		},
	});

	plugin.addCommand({
		id: 'create-mindmap-here',
		name: t(plugin.settings.language, 'command.createInCurrentFolder'),
		checkCallback: (checking) => {
			const activeFile = plugin.app.workspace.getActiveFile();
			if (checking) {
				return Boolean(activeFile);
			}
			if (activeFile) {
				void createNewMindMap(
					plugin.app,
					plugin.settings.language,
					activeFile.parent?.path ?? '',
				);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: 'search-mindmap-nodes',
		name: t(plugin.settings.language, 'command.searchNodes'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			if (checking) {
				return Boolean(view);
			}
			view?.openSearchBar();
			return true;
		},
	});

	plugin.addCommand({
		id: 'mindmap-fit-view',
		name: t(plugin.settings.language, 'command.fitCanvas'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			if (checking) {
				return Boolean(view);
			}
			if (view?.mindMap) {
				fitMindMap(view.mindMap);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: 'mindmap-arrange',
		name: t(plugin.settings.language, 'command.arrange'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			if (checking) {
				return Boolean(view);
			}
			view?.arrangeMindMap();
			return true;
		},
	});

	plugin.addCommand({
		id: 'mindmap-export-png',
		name: t(plugin.settings.language, 'command.exportPng'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			if (checking) {
				return Boolean(view);
			}
			void view?.exportPNG();
			return true;
		},
	});

	// .mindmap.md：当前 markdown 视图（编辑/阅读均可）→ 导图视图
	plugin.addCommand({
		id: 'mindmap-open-md-as-view',
		name: t(plugin.settings.language, 'command.openAsMindMap'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			const file = view?.file;
			if (!file || !isMindMapMarkdownFile(file)) {
				return false;
			}
			if (checking) {
				return true;
			}
			void openAsMindMap(view.leaf, file);
			return true;
		},
	});

	// md 文档模式：从导图视图切回 Markdown
	plugin.addCommand({
		id: 'mindmap-back-to-markdown',
		name: t(plugin.settings.language, 'command.backToMarkdown'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			if (!view?.isMdDocument()) {
				return false;
			}
			if (checking) {
				return true;
			}
			view.backToMarkdown();
			return true;
		},
	});

	plugin.addRibbonIcon(
		'network',
		t(plugin.settings.language, 'command.createMindMap'),
		() => {
			void createNewMindMap(plugin.app, plugin.settings.language);
		},
	);
}
