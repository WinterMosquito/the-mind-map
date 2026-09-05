/**
 * 画布粘贴处理：容器内 Ctrl+V 粘贴图片（写入附件目录并设置节点图片）、
 * 窗口级兜底监听。从 view.ts 拆出。
 */
import { Notice } from 'obsidian';
import { getActiveNode } from './mindmap';
import { saveImageToVault } from './images';
import { applyNodeImage } from './view-node-actions';
import { t } from './i18n';
import { MindMapView } from './view';

/** 注册画布容器粘贴监听（引擎重建时随 initMindMap 调用） */
export function setupPasteHandler(view: MindMapView): void {
	if (!view.containerEl) {
		return;
	}
	// 需求 3：画布任意位置 Ctrl+V 粘贴图片（容器内监听）。
	// 窗口级兜底在 onOpen 注册一次，避免每次刷新引擎累积监听。
	view.engineEvents.onDom(view.containerEl, 'paste', (event) => {
		void handlePasteEvent(view, event);
	});
}

/**
 * 窗口级粘贴兜底（焦点在画布容器外时仍可粘贴）：
 * 仅在当前激活视图是本思维导图且剪贴板含图片时处理。
 */
export function handleWindowPaste(view: MindMapView, event: ClipboardEvent): void {
	if (event.defaultPrevented) {
		return;
	}
	const target = event.target as Node | null;
	if (target && view.containerEl?.contains(target)) {
		return; // 容器监听已处理
	}
	if (view.app.workspace.getActiveViewOfType(MindMapView) !== view) {
		return;
	}
	if (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement
	) {
		return; // 输入框内不劫持
	}
	void handlePasteEvent(view, event);
}

async function handlePasteEvent(
	view: MindMapView,
	event: ClipboardEvent,
): Promise<void> {
	const items = event.clipboardData?.items;
	if (!items) {
		return;
	}
	let imageFile: File | null = null;
	for (const item of Array.from(items)) {
		if (item.type.startsWith('image/')) {
			imageFile = item.getAsFile();
			break;
		}
	}
	if (!imageFile) {
		return;
	}
	event.preventDefault();
	const node = getActiveNode(view.mindMap);
	if (!node) {
		new Notice(t(view.lang, 'common.selectNodeBeforePasteImage'));
		return;
	}
	new Notice(t(view.lang, 'common.savingClipboardImage'));
	try {
		const saved = await saveImageToVault(
			view.app,
			view.file?.path ?? '',
			imageFile,
			undefined,
			view.lang,
		);
		if (saved) {
			await applyNodeImage(view, node, view.app.vault.getResourcePath(saved));
			new Notice(`${t(view.lang, 'common.imageSavedTo')}${saved.path}`);
		}
	} catch (error) {
		console.error('粘贴图片失败', error);
		new Notice(
			`${t(view.lang, 'common.pasteImageFailed')}${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
