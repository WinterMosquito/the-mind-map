/**
 * 右键菜单：节点右键完整菜单与画布空白处通用菜单。从 view.ts 拆出。
 * 菜单动作（复制/粘贴/链接/图片/删除等）委托给 view-node-actions.ts。
 */
import { Menu } from 'obsidian';
import { findNodeByDom, fitMindMap } from './mindmap';
import {
	addImageToActiveNode,
	addLinkToActiveNode,
	clearNodeHyperlink,
	copyNode,
	deleteActiveNode,
	pasteNodeAsChild,
} from './view-node-actions';
import { removeNodeImage } from './view-attachments';
import { openNodeImageFullscreen } from './view-image-fullscreen';
import { arrangeMindMap } from './view-toolbar';
import { t } from './i18n';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapView } from './view';

/** 注册右键菜单监听（引擎重建时随 initMindMap 调用） */
export function setupContextMenu(view: MindMapView): void {
	if (!view.canvasEl || !view.mindMap) {
		return;
	}
	// 节点右键：引擎对节点 contextmenu 做了 stopPropagation，
	// 事件不会冒泡到画布，必须改用引擎的 node_contextmenu 事件。
	view.engineEvents.onEngine(view.mindMap, 'node_contextmenu', (...args: unknown[]) => {
		const event = args[0] as MouseEvent;
		const node = args[1] as MindMapNode | undefined;
		if (node) {
			showNodeContextMenu(view, event, node);
		}
	});
	// 空白处右键：画布委托。附件图标等未 stopPropagation 的冒泡事件
	// 命中节点时也统一走节点菜单，避免双菜单或菜单丢失。
	view.engineEvents.onDom(view.canvasEl, 'contextmenu', (event) => {
		event.preventDefault();
		const target = event.target as HTMLElement;
		const nodeEl = target.closest<HTMLElement>('.smm-node');
		const node = nodeEl ? findNodeByDom(view.mindMap, nodeEl) : null;
		if (node) {
			showNodeContextMenu(view, event, node);
			return;
		}
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'menu.pasteNode'))
				.setIcon('clipboard')
				.onClick(() => pasteNodeAsChild(view, null)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'command.fitCanvas'))
				.setIcon('maximize')
				.onClick(() => fitMindMap(view.mindMap)),
		);
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'toolbar.arrange'))
				.setIcon('sparkles')
				.onClick(() => arrangeMindMap(view)),
		);
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'toolbar.undoShort'))
				.setIcon('undo')
				.onClick(() => view.mindMap?.execCommand('BACK')),
		);
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'toolbar.redoShort'))
				.setIcon('redo')
				.onClick(() => view.mindMap?.execCommand('FORWARD')),
		);
		menu.showAtPosition({ x: event.clientX, y: event.clientY });
	});
}

/** 节点右键菜单（含单独移除图片/附件） */
function showNodeContextMenu(
	view: MindMapView,
	event: MouseEvent,
	node: MindMapNode,
): void {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return;
	}
	// 引擎无 ACTIVE_NODE 命令；节点实例的 active() 是官方激活方式
	node.active();
	const menu = new Menu();
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.editText'))
			.setIcon('pencil')
			// 引擎无 ENTER_TEXT_EDIT 命令；node_dblclick 是文本编辑的官方入口
			.onClick(() =>
				mindMap.emit('node_dblclick', node, null, true),
			),
	);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.addChild'))
			.setIcon('plus')
			.onClick(() => mindMap.execCommand('INSERT_CHILD_NODE')),
	);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.addSibling'))
			.setIcon('circle-plus')
			.onClick(() => mindMap.execCommand('INSERT_NODE')),
	);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.copyNode'))
			.setIcon('copy')
			.onClick(() => copyNode(view, node)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.pasteAsChild'))
			.setIcon('clipboard')
			.onClick(() => pasteNodeAsChild(view, node)),
	);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.addLink'))
			.setIcon('link')
			.onClick(() => {
				void addLinkToActiveNode(view);
			}),
	);
	// 节点已有链接时提供「清除链接」
	if (node.getData('hyperlink')) {
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'modal.link.clear'))
				.setIcon('unlink')
				.onClick(() => clearNodeHyperlink(view, node)),
		);
	}
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.addImage'))
			.setIcon('image')
			.onClick(() => {
				void addImageToActiveNode(view);
			}),
	);
	menu.addSeparator();
	if (node.getData('image')) {
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'menu.viewImageFullscreen'))
				.setIcon('maximize')
				.onClick(() => openNodeImageFullscreen(view, node)),
		);
		menu.addItem((item) =>
			item
				.setTitle(t(view.lang, 'menu.removeImage'))
				.setIcon('image')
				.onClick(() => removeNodeImage(view, node)),
		);
	}
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'menu.deleteNode'))
			.setIcon('trash-2')
			.onClick(() => deleteActiveNode(view)),
	);
	menu.showAtPosition({ x: event.clientX, y: event.clientY });
}
