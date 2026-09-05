/**
 * 画布拖拽与文件输入：库内文件拖入（图片/笔记）、外部图片导入。从 view.ts 拆出。
 */
import { Notice, type TFile } from 'obsidian';
import { isImageExtension, MAX_IMAGE_SIZE_MB } from './constants';
import { saveImageToVault } from './images';
import { extractDroppedFileNames, resolveDroppedFile } from './links';
import { getActiveNode } from './mindmap';
import { applyNodeImage } from './view-node-actions';
import { t } from './i18n';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapView } from './view';

/** 注册画布拖拽监听（引擎重建时随 initMindMap 调用） */
export function setupDragAndDrop(view: MindMapView): void {
	if (!view.canvasEl) {
		return;
	}
	const canvas = view.canvasEl;
	view.engineEvents.onDom(canvas, 'dragover', (event) => {
		if (!event.dataTransfer) {
			return;
		}
		const hasFileData =
			event.dataTransfer.types.includes('text/plain') ||
			event.dataTransfer.files.length > 0 ||
			Array.from(event.dataTransfer.types).some((type) =>
				type.toLowerCase().includes('file'),
			);
		if (hasFileData) {
			event.preventDefault();
			event.stopPropagation();
			canvas.addClass('mindmap-drag-over');
			event.dataTransfer.dropEffect = 'link';
		}
	});
	view.engineEvents.onDom(canvas, 'dragleave', (event) => {
		if (!canvas.contains(event.relatedTarget as Node | null)) {
			canvas.removeClass('mindmap-drag-over');
		}
	});
	view.engineEvents.onDom(canvas, 'drop', (event) => {
		if (!event.dataTransfer) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		canvas.removeClass('mindmap-drag-over');
		void handleFileDrop(view, event).catch((error) => {
			console.error('处理拖入文件失败', error);
		});
	});
}

/** 拖入文件分发：库内文件 vs 外部附件 */
async function handleFileDrop(view: MindMapView, event: DragEvent): Promise<void> {
	const dataTransfer = event.dataTransfer;
	if (!dataTransfer) {
		return;
	}
	const file = resolveDroppedFile(dataTransfer, view.app);
	if (!file) {
		// 需求 3：无法解析为库内文件时，识别外部附件并导入库中
		await handleExternalFilesDrop(view, dataTransfer);
		return;
	}
	await handleDroppedVaultFile(view, file);
}

/**
 * 处理拖入的库内文件：
 * - 已选中主题 → 直接归入该主题；
 * - 未选中 → 按原逻辑处理（提示选择或挂到根节点下）。
 */
async function handleDroppedVaultFile(view: MindMapView, file: TFile): Promise<void> {
	const selected = getActiveNode(view.mindMap);
	const url = view.app.vault.getResourcePath(file);
	const extension = file.extension.toLowerCase();

	if (isImageExtension(extension)) {
		if (selected) {
			await applyNodeImage(view, selected, url);
			new Notice(`${t(view.lang, 'common.imageSetOnNode')}${file.name}`);
		} else {
			new Notice(t(view.lang, 'common.selectNodeBeforeDropImage'));
		}
		return;
	}

	if (extension === 'md') {
		await handleDroppedDocument(view, file, selected);
		return;
	}

	// 其余类型（含音视频/PDF 等附件）无法写回 Markdown，拒绝
	new Notice(t(view.lang, 'common.onlySupportedFiles'));
}

/** 拖入文档：已选中主题 → 链接；未选中 → 挂到根节点下并链接 */
async function handleDroppedDocument(
	view: MindMapView,
	file: TFile,
	selected: MindMapNode | null,
): Promise<void> {
	const link = `[[${file.basename}]]`;
	if (selected) {
		view.mindMap?.execCommand('SET_NODE_HYPERLINK', selected, link);
		new Notice(`${t(view.lang, 'common.linkedTo')} [[${file.basename}]]`);
	} else {
		// 原逻辑：挂到根节点下并链接（通过 appointNodes 指定父节点，
		// 不依赖激活列表；初始数据直接携带文本与链接）
		const root = view.mindMap?.renderer?.root;
		if (root) {
			view.mindMap?.execCommand('INSERT_CHILD_NODE', false, [root], {
				text: file.basename,
				hyperlink: link,
				isActive: false,
			});
			new Notice(`${t(view.lang, 'common.nodeCreatedAndLinked')} [[${file.basename}]]`);
		}
	}
}

/**
 * 外部（系统）文件拖入处理：仅支持图片（渲染层定位——非图片附件无法
 * 写回 Markdown），识别后导入库中，存储路径遵循系统「附件存放位置」规则，
 * 再归入选中的主题（未选中时提示先选择）。
 */
async function handleExternalFilesDrop(
	view: MindMapView,
	dataTransfer: DataTransfer,
): Promise<void> {
	const files = Array.from(dataTransfer.files);
	const droppedNonImage = files.some((f) => !f.type.startsWith('image/'));
	const images = files.filter((f) => f.type.startsWith('image/'));
	if (droppedNonImage) {
		new Notice(t(view.lang, 'common.onlyImagesSupported'));
	}
	if (images.length === 0) {
		let details = '';
		Array.from(dataTransfer.types).forEach((type) => {
			try {
				const value = dataTransfer.getData(type);
				if (value) {
					details += `${type}: ${value.slice(0, 100)} | `;
				}
			} catch {
				// 忽略
			}
		});
		new Notice(
			t(view.lang, 'common.noImagesDropped') +
				(details ? `\n${t(view.lang, 'attachment.dragData')}${details}` : ''),
			8000,
		);
		return;
	}

	// 需要先选中一个主题作为归属
	const selected = getActiveNode(view.mindMap);
	if (!selected) {
		new Notice(t(view.lang, 'common.selectNodeBeforeDrop'));
		return;
	}

	new Notice(`${t(view.lang, 'common.importing')} ${images.length} ${t(view.lang, 'common.imagesToVault')}`);
	// 修复文件名乱码：优先用 text/uri-list 解码出的真实文件名
	// （File.name 在部分 Windows 来源下被系统 ANSI 代码页错误解码）。
	// 仅当数量一致时按序对应，避免文件名错位。
	const realNames = extractDroppedFileNames(dataTransfer);
	const useRealNames = realNames.length === images.length;
	const sourcePath = view.file?.path ?? '';
	// 顺序保存：文件名保持原名，重名由 saveImageToVault 的序号兜底处理；
	// 顺序写入避免同名文件并发保存时互相覆盖。
	let importedCount = 0;
	for (let index = 0; index < images.length; index++) {
		const file = images[index];
		if (!file) {
			continue;
		}
		const saved = await saveImageToVault(
			view.app,
			sourcePath,
			file,
			MAX_IMAGE_SIZE_MB,
			useRealNames ? realNames[index] : undefined,
			view.lang,
		);
		if (!saved) {
			continue;
		}
		importedCount++;
		await applyNodeImage(view, selected, view.app.vault.getResourcePath(saved));
		new Notice(`${t(view.lang, 'common.imageSetOnNode')}${saved.name}`);
	}
	if (importedCount > 0) {
		new Notice(
			`${t(view.lang, 'common.imported')} ${importedCount} ${t(
				view.lang,
				'common.imagesStored',
			)}`,
			5000,
		);
	}
}
