/**
 * 状态栏：节点计数展示（带节流与尾随刷新）。从 view.ts 拆出。
 */
import { t } from './i18n';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapView } from './view';

/** 更新状态栏节点计数（data_change 高频事件下节流，尾随定时器保证最终值） */
export function updateStatusBar(view: MindMapView): void {
	if (!view.plugin.statusBarEl) {
		return;
	}
	if (!view.mindMap) {
		view.plugin.statusBarEl.setText('');
		return;
	}
	// 性能：节点计数节流（连续编辑时避免每次 data_change 全树遍历），
	// 节流期间用尾随定时器保证最终显示最新值。
	const now = Date.now();
	if (now - view.lastStatusBarUpdate < 300) {
		if (view.statusBarTrailingTimer === null) {
			view.statusBarTrailingTimer = window.setTimeout(() => {
				view.statusBarTrailingTimer = null;
				view.lastStatusBarUpdate = 0;
				updateStatusBar(view);
			}, 300);
		}
		return;
	}
	view.lastStatusBarUpdate = now;
	try {
		const count = countRenderNodes(view.mindMap.renderer.root);
		view.plugin.statusBarEl.setText(`${count} ${t(view.lang, 'common.nodes')}`);
	} catch {
		view.plugin.statusBarEl.setText('');
	}
}

/** 轻量遍历已渲染节点树计数（避免高频 data_change 时深拷贝整棵树） */
function countRenderNodes(node: MindMapNode | null): number {
	if (!node) {
		return 0;
	}
	let count = 1;
	for (const child of node.children) {
		count += countRenderNodes(child);
	}
	return count;
}
