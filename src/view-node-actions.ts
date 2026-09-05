/**
 * 节点操作：增删改节点（链接/图片）、复制粘贴、删除。
 * 被工具栏（view-toolbar.ts）与右键菜单（view-context-menu.ts）共用。
 */
import { App, Notice, TFile } from 'obsidian';
import { getActiveNode } from './mindmap';
import {
	createAspectSetNodeImageOptions,
	findAttachmentFile,
	saveImageToVault,
} from './images';
import { openImageEditorModal, openLinkEditorModal } from './modals';
import { t } from './i18n';
import { isExternalOrProtocolUrl } from './constants';
import type {
	MindMapNode,
	MindMapNodeData,
} from '../vendor/simple-mind-map.cjs';
import type { MindMapView } from './view';

/** 给当前激活节点添加链接（无节点时提示） */
export async function addLinkToActiveNode(view: MindMapView): Promise<void> {
	const node = getActiveNode(view.mindMap);
	if (!node) {
		new Notice(t(view.lang, 'common.selectNodeFirst'));
		return;
	}
	const current = (node.getData?.('hyperlink') as string) || '';
	const result = await openLinkEditorModal(view.app, current, view.lang);
	if (result === null) {
		return;
	}
	view.mindMap?.execCommand('SET_NODE_HYPERLINK', node, result.link);
	// URL/协议链接：仅添加超链接图标——不把 <url> 当作节点文本（尖括号内链接不渲染）。
	// 笔记/附件（..）仍按 Obsidian 双链语义用其可见名更新节点文本。
	if (result.link && isExternalOrProtocolUrl(result.link)) {
		view.scheduleSave();
		return;
	}
	// 与 Obsidian 双链对齐：链接的「可见文本」同步到节点文本——
	// 仅当节点文本为空、或文本仍是旧链接的可见名（改链场景）时更新，
	// 保留用户已有正文（正文节点只附加链接）。
	const newDisplay = result.label ?? displayFromHyperlink(result.link);
	const oldDisplay = current ? displayFromHyperlink(current) : null;
	const text = (node.getData?.('text') as string | undefined) ?? '';
	if (newDisplay && (!text.trim() || text.trim() === oldDisplay)) {
		applyNodeText(view, node, newDisplay);
	}
	view.scheduleSave();
}

/** 由链接文本推导「可见文本」（Obsidian 双链语义：别名→目标名；URL 原样） */
function displayFromHyperlink(link: string): string | null {
	if (!link) {
		return null;
	}
	if (!link.startsWith('[[')) {
		return link; // http / obsidian:// / 库内路径：原样可见
	}
	const inner = link.slice(2, -2);
	const target = inner.split('|')[0] ?? inner;
	const alias = inner.includes('|') ? inner.slice(inner.indexOf('|') + 1) : '';
	if (alias) {
		return alias;
	}
	const name = target.split('/').pop() ?? target;
	// 仅去除 .md 扩展（笔记显示名）；附件保留扩展
	return name.replace(/\.md$/, '');
}

/** 更新节点文本并让引擎重绘该节点（不改写引擎其它状态） */
function applyNodeText(view: MindMapView, node: MindMapNode, text: string): void {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return;
	}
	node.nodeData.data.text = text;
	try {
		mindMap.execCommand('SET_NODE_DATA', node, { text });
	} catch {
		// SET_NODE_DATA 不可用等情形：直接数据已改，交由重绘
	}
	mindMap.render();
}

/** 清除节点超链接（不影响节点其他数据） */
export function clearNodeHyperlink(
	view: MindMapView,
	node: MindMapNode,
): void {
	const current = (node.getData?.('hyperlink') as string) || '';
	if (!current) {
		return;
	}
	view.mindMap?.execCommand('SET_NODE_HYPERLINK', node, '');
	view.scheduleSave();
}

/** 插入图片（需求 1 + 2）：统一固定尺寸；支持本地文件/剪贴板/URL */
export async function addImageToActiveNode(view: MindMapView): Promise<void> {
	const node = getActiveNode(view.mindMap);
	if (!node) {
		new Notice(t(view.lang, 'common.selectNodeFirst'));
		return;
	}
	const current = (node.getData?.('image') as string) || '';
	const result = await openImageEditorModal(
		view.app,
		current,
		(file, maxSizeMB) =>
			saveImageToVault(
				view.app,
				view.file?.path ?? '',
				file,
				maxSizeMB,
				view.lang,
			),
		view.lang,
	);
	if (result === null) {
		return;
	}
	await applyNodeImage(view, node, result);
}

/**
 * 以统一高度、按图片原始比例设置节点图片（需求 1）：
 * 先探测图片原始尺寸，再以 custom:true 精确指定展示尺寸，
 * 使节点外框比例跟随图片比例（所有图片高度统一，宽度按比例）。
 *
 * 引用归一（与 Obsidian 图片引用语义对齐）：
 * - 库内路径（联想/手动输入/选择本地保存后）→ 显示用资源地址（app://），
 *   同时记录 mdImageTarget=库内路径（保存回写 ![[路径]]）；
 * - 已是 app://（拖入/粘贴）→ 反查库内路径记录 mdImageTarget；
 * - 外链（http/data/blob/file）→ 原样显示，无 md 回写目标。
 */
export async function applyNodeImage(
	view: MindMapView,
	node: MindMapNode,
	url: string,
): Promise<void> {
	const { display, mdTarget } = normalizeImageReference(url, view.app);
	const options = await createAspectSetNodeImageOptions(display);
	view.mindMap?.execCommand('SET_NODE_IMAGE', node, options);
	// 记录/清除 md 回写目标（引擎不识别该字段，仅序列化用）
	const data = node.getData() as MindMapNodeData;
	const oldTarget =
		typeof data.mdImageTarget === 'string' ? data.mdImageTarget : '';
	const text = typeof data.text === 'string' ? data.text : '';
	// 纯图节点的占位文本（旧图文件名）随换图同步，避免回写残留旧名
	const oldName = oldTarget.split('/').pop() ?? '';
	if (oldName && text === oldName) {
		data.text = mdTarget ? (mdTarget.split('/').pop() ?? '') : '';
		data.mdDerivedText = data.text;
	}
	if (mdTarget) {
		data.mdImageTarget = mdTarget;
	} else {
		delete data.mdImageTarget;
	}
	view.scheduleSave();
}

/** 引用归一：显示地址 + md 回写目标 */
export function normalizeImageReference(
	url: string,
	app: App,
): { display: string; mdTarget: string | null } {
	if (!url) {
		return { display: '', mdTarget: null };
	}
	if (url.startsWith('app://')) {
		// 资源地址：反查库内路径（md 回写目标）
		const file = findAttachmentFile(app, url);
		return { display: url, mdTarget: file?.path ?? null };
	}
	if (
		url.startsWith('http://') ||
		url.startsWith('https://') ||
		url.startsWith('data:') ||
		url.startsWith('blob:') ||
		url.startsWith('file://')
	) {
		return { display: url, mdTarget: null };
	}
	// 其余按库内路径：解析为资源地址显示，记录库内路径
	const hit = app.vault.getAbstractFileByPath(url.trim());
	return {
		display: hit instanceof TFile ? app.vault.getResourcePath(hit) : url,
		mdTarget: url.trim(),
	};
}

/**
 * 删除选中节点（修复 3/4）：
 * 1. 先走引擎 REMOVE_NODE 常规路径（实例清理 + 历史记录 + 渲染）；
 * 2. 兜底：若节点数据因 uid 异常未被清除，按对象身份强制移除，杜绝残留。
 * 附件回收询问不在此处处理：由视图 data_change 引用 diff 统一检测
 * （任何移除引用路径——键盘删除/右键删除/移除图片——都经它询问是否回收）。
 */
export function deleteActiveNode(view: MindMapView): void {
	const mindMap = view.mindMap;
	const node = getActiveNode(mindMap);
	if (!mindMap || !node) {
		new Notice(t(view.lang, 'common.selectNodeFirst'));
		return;
	}
	if (node.isRoot) {
		new Notice(t(view.lang, 'common.rootCannotDelete'));
		return;
	}
	const parent = node.parent;
	const nodeData = node.nodeData;
	mindMap.execCommand('REMOVE_NODE');
	// 兜底：uid 重复/缺失时引擎按 uid 的删除可能失败，按对象身份强制清除
	if (parent) {
		const index = parent.nodeData.children.findIndex(
			(child) => child === nodeData,
		);
		if (index !== -1) {
			parent.nodeData.children.splice(index, 1);
			mindMap.render();
		}
	}
	view.scheduleSave();
}

/** 复制节点（深拷贝节点数据到视图剪贴板） */
export function copyNode(view: MindMapView, node: MindMapNode): void {
	const data = node.getData
		? (node.getData() as MindMapNodeData)
		: node.nodeData.data;
	view.clipboardNode = JSON.parse(JSON.stringify(data)) as MindMapNodeData;
	new Notice(t(view.lang, 'common.nodeCopied'));
}

/** 粘贴剪贴板节点为指定节点的子节点（未指定时挂到根节点） */
export function pasteNodeAsChild(
	view: MindMapView,
	node: MindMapNode | null,
): void {
	if (!view.clipboardNode) {
		new Notice(t(view.lang, 'common.clipboardEmpty'));
		return;
	}
	// 复制的是节点数据；剥离 uid 与激活状态后作为新节点的初始数据
	const { uid: _uid, isActive: _isActive, ...clipboardData } =
		view.clipboardNode;
	// 通过 appointNodes 指定父节点（引擎的 ACTIVE_NODE 命令不存在，
	// 且渲染为异步，不能依赖激活列表）。
	// 未选中节点时挂到根节点下：引擎在 appointNodes 与激活列表均为空时
	// 直接 return，空数组粘贴会静默失效。
	const parent = node ?? view.mindMap?.renderer?.root ?? null;
	view.mindMap?.execCommand(
		'INSERT_CHILD_NODE',
		false,
		parent ? [parent] : [],
		{ ...clipboardData, isActive: false },
	);
}
