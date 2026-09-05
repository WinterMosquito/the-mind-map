/**
 * wikilink 交互（方案 A）：导图节点悬停预览 + Ctrl/Cmd+点击跳转，
 * 行为对齐 Obsidian 阅读视图：
 * - 悬停含 [[链接]] 的节点 → workspace 'hover-link'（Obsidian 原生页面预览）；
 *   挂在引擎 node_mouseenter 事件上（事件源在引擎层，不依赖 DOM 冒泡）；
 * - Ctrl/Cmd+点击节点 → 新标签页打开目标（openLinkText 'tab'）；
 * - 附件图标悬停预览由 view-attachments 独立处理，互不干扰。
 *
 * 前置：main.ts 已 registerHoverLinkSource(VIEW_TYPE)，否则 core 忽略 hover-link。
 */
import { VIEW_TYPE } from './constants';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapView } from './view';

/** 提取 [[x|y]] 的目标 x（保留 # 区块；别名由显示层处理） */
function wikiTarget(hyperlink: string): string | null {
	if (!hyperlink.startsWith('[[')) {
		return null;
	}
	const inner = hyperlink.slice(2, -2);
	const target = inner.split('|')[0] ?? '';
	return target || null;
}

/** 悬停防抖（与附件预览共用状态字段，互斥触发） */
const HOVER_DEBOUNCE_MS = 400;

/** 节点引擎 group 的 DOM（用作 hover-link 锚元素；group 为引擎内部字段） */
function nodeGroupEl(node: MindMapNode): Element | null {
	const group = (node as unknown as { group?: { node?: Element } }).group;
	return group?.node ?? null;
}

/** 注册 wikilink 的悬停预览与 Ctrl/Cmd+点击（initMindMap 内调用一次） */
export function registerWikilinkInteractions(view: MindMapView): void {
	if (!view.mindMap) {
		return;
	}

	// Ctrl/Cmd + 点击 → 新标签打开（引擎 node_click 携带原始事件）
	view.engineEvents.onEngine(view.mindMap, 'node_click', (...args: unknown[]) => {
		const node = args[0] as MindMapNode | undefined;
		const event = args[1] as MouseEvent | undefined;
		if (!node || !event || !(event.ctrlKey || event.metaKey)) {
			return;
		}
		const hyperlink = node.getData('hyperlink');
		if (typeof hyperlink !== 'string' || !hyperlink) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		view.openHyperlink(hyperlink, true);
	});

	// 悬停节点（引擎事件）→ 页面预览
	view.engineEvents.onEngine(
		view.mindMap,
		'node_mouseenter',
		(...args: unknown[]) => {
			const node = args[0] as MindMapNode | undefined;
			const event = args[1] as MouseEvent | undefined;
			if (!node || !event) {
				return;
			}
			const hyperlink = node.getData('hyperlink');
			if (typeof hyperlink !== 'string' || !hyperlink) {
				return;
			}
			const linktext = wikiTarget(hyperlink);
			if (!linktext) {
				return;
			}
			const targetEl = nodeGroupEl(node);
			if (!targetEl) {
				return;
			}
			const now = Date.now();
			if (
				targetEl === view.lastHoverPreviewEl &&
				now - view.lastHoverPreviewAt < HOVER_DEBOUNCE_MS
			) {
				return;
			}
			view.lastHoverPreviewEl = targetEl;
			view.lastHoverPreviewAt = now;
			view.app.workspace.trigger('hover-link', {
				event,
				source: VIEW_TYPE,
				hoverParent: view.containerEl,
				targetEl,
				linktext,
				sourcePath: view.file?.path ?? '',
			});
		},
	);
}
