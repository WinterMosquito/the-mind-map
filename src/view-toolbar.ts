/**
 * 工具栏逻辑：构建/重建工具栏、工具按钮、自动整理。从 view.ts 拆出。
 * 节点操作（备注/链接/图片/删除）委托给 view-node-actions.ts。
 */
import { Notice, setIcon } from 'obsidian';
import { LAYOUT_OPTIONS } from './constants';
import { arrangeMindMap as arrangeMindMapEngine, fitMindMap } from './mindmap';
import { openSearchBar } from './view-search';
import { exportPNG } from './view-export';
import {
	addImageToActiveNode,
	addLinkToActiveNode,
	deleteActiveNode,
} from './view-node-actions';
import { t } from './i18n';
import type { MindMapView } from './view';

/** 构建工具栏（左：编辑/插入；中：布局；右：画布/导入导出） */
export function buildToolbar(view: MindMapView): void {
	if (!view.toolbarEl) {
		return;
	}
	const toolbar = view.toolbarEl;

	const leftGroup = toolbar.createDiv('mindmap-toolbar-group');
	// md 文档模式（.mindmap.md）：提供返回 Markdown 编辑/阅读的入口
	if (view.isMdDocument()) {
		createToolButton(
			leftGroup,
			t(view.lang, 'toolbar.backToMarkdown'),
			'file-text',
			() => view.backToMarkdown(),
		);
		leftGroup.createDiv('mindmap-toolbar-separator');
	}
	createToolButton(leftGroup, t(view.lang, 'toolbar.addChild'), 'plus', () => {
		view.mindMap?.execCommand('INSERT_CHILD_NODE');
	});
	createToolButton(leftGroup, t(view.lang, 'toolbar.addSibling'), 'circle-plus', () => {
		view.mindMap?.execCommand('INSERT_NODE');
	});
	createToolButton(leftGroup, t(view.lang, 'toolbar.deleteNode'), 'trash-2', () => {
		deleteActiveNode(view);
	});
	leftGroup.createDiv('mindmap-toolbar-separator');
	createToolButton(leftGroup, t(view.lang, 'toolbar.undo'), 'undo', () => {
		view.mindMap?.execCommand('BACK');
	});
	createToolButton(leftGroup, t(view.lang, 'toolbar.redo'), 'redo', () => {
		view.mindMap?.execCommand('FORWARD');
	});
	createToolButton(
		leftGroup,
		t(view.lang, 'toolbar.arrange'),
		'sparkles',
		() => arrangeMindMap(view),
	);
	leftGroup.createDiv('mindmap-toolbar-separator');
	createToolButton(leftGroup, t(view.lang, 'toolbar.search'), 'search', () =>
		openSearchBar(view),
	);
	createToolButton(leftGroup, t(view.lang, 'toolbar.insertLink'), 'link', () => {
		void addLinkToActiveNode(view);
	});
	createToolButton(leftGroup, t(view.lang, 'toolbar.insertImage'), 'image', () => {
		void addImageToActiveNode(view);
	});

	const centerGroup = toolbar.createDiv(
		'mindmap-toolbar-group mindmap-toolbar-center',
	);
	centerGroup.createSpan('mindmap-toolbar-label').setText(t(view.lang, 'toolbar.layout'));
	view.layoutSelect = centerGroup.createEl('select', {
		cls: 'mindmap-layout-select',
	});
	LAYOUT_OPTIONS.forEach((option) => {
		const optionEl = view.layoutSelect!.createEl('option');
		optionEl.value = option.value;
		optionEl.setText(t(view.lang, option.label));
	});
	view.layoutSelect.value = view.plugin.settings.defaultLayout;
	view.layoutSelect.onchange = () => {
		if (view.layoutSelect) {
			// 布局持久化到视图状态存储（.mindmap.md 正文不写入布局）
			view.applyLayout(view.layoutSelect.value);
		}
	};

	const rightGroup = toolbar.createDiv(
		'mindmap-toolbar-group mindmap-toolbar-right',
	);
	createToolButton(rightGroup, t(view.lang, 'command.fitCanvas'), 'maximize', () =>
		fitMindMap(view.mindMap),
	);
	createToolButton(rightGroup, t(view.lang, 'toolbar.zoomIn'), 'zoom-in', () =>
		view.mindMap?.view.enlarge(),
	);
	createToolButton(rightGroup, t(view.lang, 'toolbar.zoomOut'), 'zoom-out', () =>
		view.mindMap?.view.narrow(),
	);
	rightGroup.createDiv('mindmap-toolbar-separator');
	createToolButton(rightGroup, t(view.lang, 'toolbar.exportPng'), 'image', () => {
		void exportPNG(view);
	});
}

/** 创建工具栏按钮（标题/图标/点击回调） */
function createToolButton(
	container: HTMLElement,
	title: string,
	icon: string,
	onClick: () => void,
): HTMLButtonElement {
	const button = container.createEl('button', {
		cls: 'mindmap-tool-btn',
		attr: { title, 'aria-label': title },
	});
	setIcon(button, icon);
	button.onclick = onClick;
	return button;
}

/** 自动整理（需求 3）：重新按布局算法对齐摆放各主题并适配画布 */
export function arrangeMindMap(view: MindMapView): void {
	if (!view.mindMap) {
		new Notice(t(view.lang, 'common.notLoaded'));
		return;
	}
	if (arrangeMindMapEngine(view.mindMap)) {
		new Notice(t(view.lang, 'common.arrangeDone'));
	} else {
		new Notice(t(view.lang, 'common.arrangeFailed'));
	}
}

/** 设置变更后重建工具栏 */
export function refreshToolbar(view: MindMapView): void {
	if (!view.toolbarEl) {
		return;
	}
	view.toolbarEl.empty();
	buildToolbar(view);
}
