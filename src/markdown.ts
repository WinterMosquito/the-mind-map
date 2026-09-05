/**
 * Markdown 渲染模式工具：新建文件名/默认正文/uid 修复。
 *
 * 解析（正文 → 导图树）与序列化（树 → md）见 md-outline.ts / md-serialize.ts；
 * 行内 wikilink 交互见 view-wikilink.ts。本文件不含任何专有格式逻辑。
 */
import { generateUid } from './constants';
import { t, type Language } from './i18n';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';

/**
 * 新建「Markdown 思维导图」(.mindmap.md) 的默认正文：
 * 渲染层定位——新文件是标准 Markdown（提示列表；无标题时中心主题 = 文件名，
 * 列表项即第 1 级子主题，与旧版默认树观感一致）。
 */
export function createDefaultMarkdownContent(lang: Language = 'zh'): string {
	return [
		`- ${t(lang, 'default.shortcutHint')}`,
		`- ${t(lang, 'default.tabHint')}`,
		`- ${t(lang, 'default.enterHint')}`,
		'',
	].join('\n');
}

/**
 * 新建思维导图的默认文件名（不含扩展名）：
 * 「思维导图」+ 当前日期，如 思维导图2026-08-21。
 */
export function buildDefaultMindMapName(lang: Language = 'zh', now = new Date()): string {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${t(lang, 'default.fileNamePrefix')}${year}-${month}-${day}`;
}

/**
 * 修复树中缺失或重复的节点 uid。
 * 导入的外部 md/JSON 可能包含重复/缺失 uid，会导致引擎按 uid 查找节点时
 * 误删/漏删。返回是否有修改。
 */
export function ensureUniqueUids(tree: MindMapTreeNode): boolean {
	const seen = new Set<string>();
	let changed = false;
	// 显式栈替代递归：树深度可由导入内容任意构造，递归会栈溢出
	const stack: MindMapTreeNode[] = [tree];
	while (stack.length > 0) {
		const node = stack.pop()!;
		if (!node.data) {
			node.data = { text: '' };
		}
		const uid = node.data.uid;
		if (!uid || seen.has(uid)) {
			node.data.uid = generateUid();
			changed = true;
		} else {
			seen.add(uid);
		}
		if (node.children) {
			for (const child of node.children) {
				stack.push(child);
			}
		}
	}
	return changed;
}
