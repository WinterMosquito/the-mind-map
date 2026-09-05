/**
 * 节点图片编辑弹窗（与 Obsidian 图片引用语义对齐）：
 * - 输入框联想库内图片文件（Obsidian 输入 ![[ 风格，AbstractInputSuggest）；
 * - 库内路径 / http(s) / data URL 均可；
 * - 「选择本地图片」保存到附件目录后插入；「粘贴图片」从剪贴板读取；
 * - 确认返回规范引用：库内图片 → vault 相对路径（md 回写 ![[路径]]），
 *   外链 → 原样 URL。
 */
import {
	App,
	Modal,
	AbstractInputSuggest,
	TFile,
	setIcon,
} from 'obsidian';
import { isImageExtension, MAX_IMAGE_SIZE_MB } from './constants';
import { t, type Language } from './i18n';
import { createButton } from './modal-common';

/** 库内图片联想（Obsidian 风格） */
class ImageFileSuggest extends AbstractInputSuggest<TFile> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private images: TFile[],
		private onChoose: (file: TFile) => void,
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFile[] {
		const keyword = query.toLowerCase().trim();
		if (!keyword) {
			return [];
		}
		const result: TFile[] = [];
		for (const file of this.images) {
			if (file.basename.toLowerCase().includes(keyword)) {
				result.push(file);
				if (result.length >= 20) {
					break;
				}
			}
		}
		return result;
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		const icon = el.createSpan({ cls: 'mindmap-link-suggest-icon' });
		setIcon(icon, 'image');
		el.createSpan({ text: file.name });
		const path = el.createSpan({ cls: 'note-path' });
		path.setText(file.parent?.path ?? '');
		path.addClass('mindmap-link-suggest-path');
	}

	selectSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(file);
	}
}

/** 输入是否为外链/数据地址（无需库内解析） */
function isExternalImageUrl(value: string): boolean {
	return (
		value.startsWith('http://') ||
		value.startsWith('https://') ||
		value.startsWith('data:') ||
		value.startsWith('blob:') ||
		value.startsWith('file://')
	);
}

export function openImageEditorModal(
	app: App,
	current: string,
	saveImage: (file: File, maxSizeMB?: number) => Promise<TFile | null>,
	lang: Language,
): Promise<string | null> {
	return new Promise((resolve) => {
		let settled = false;
		const settle = (value: Parameters<typeof resolve>[0]): void => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(value);
		};
		const modal = new Modal(app);
		modal.titleEl.setText(t(lang, 'modal.image.title'));
		const root = modal.contentEl.createDiv('mindmap-image-editor');

		const statusEl = root.createDiv();
		statusEl.addClass('mindmap-modal-muted-hint');

		/** 由引用文本得到「预览 URL」（库内路径 → 资源地址） */
		const toPreviewUrl = (value: string): string => {
			if (!value || isExternalImageUrl(value)) {
				return value;
			}
			// 库内路径（联想/手动输入）：转可加载资源地址预览
			const hit = app.vault.getAbstractFileByPath(value.trim());
			return hit instanceof TFile ? app.vault.getResourcePath(hit) : '';
		};

		const updateStatus = (url: string): void => {
			if (url && isExternalImageUrl(url)) {
				const shortened = url.length > 60 ? url.slice(0, 60) + '...' : url;
				statusEl.setText(`${t(lang, 'modal.image.address')}${shortened}`);
			} else if (url) {
				statusEl.setText(`${t(lang, 'modal.image.internalPath')}${url}`);
			} else {
				statusEl.setText(t(lang, 'modal.image.none'));
			}
		};
		// current 可能是资源地址（app://local/...）：解码并去掉主机前缀 → 库内路径。
		// app:// 引用来自用户可编辑 Markdown，解码失败（畸形 % 序列）须回退原值
		// 而非抛 URIError——抛错会让整个图片弹窗打不开（无未处理拒绝）。
		let initialRef = current;
		if (current.startsWith('app://')) {
			try {
				initialRef = decodeURIComponent(
					current.replace(/^app:\/\/[^/]*\//, ''),
				);
			} catch {
				// 保留原值，后续预览/保存分支兜底
			}
		}
		updateStatus(initialRef);

		const label = root.createDiv();
		label.setText(t(lang, 'modal.image.urlLabel'));
		label.addClass('mindmap-modal-label');
		const input = root.createEl('input', {
			cls: 'mindmap-modal-input',
			attr: {
				type: 'text',
				placeholder: t(lang, 'modal.image.hint'),
				value: initialRef.startsWith('obsidian://') ? '' : initialRef,
			},
		});
		input.focus();

		const fileInput = root.createEl('input', {
			attr: { type: 'file', accept: 'image/*' },
		});
		fileInput.addClass('mindmap-modal-hidden');

		const actions = root.createDiv();
		actions.addClass('mindmap-modal-action-row', 'mindmap-modal-action-row--inline');
		const chooseButton = createButton(
			actions,
			t(lang, 'modal.image.chooseLocal'),
			'secondary',
			() => fileInput.click(),
		);
		chooseButton.buttonEl.title = t(lang, 'modal.image.localHint');
		createButton(actions, t(lang, 'modal.image.paste'), 'secondary', () => {
			void pasteFromClipboard();
		});
		const fileStatus = actions.createSpan();
		fileStatus.addClass('mindmap-modal-file-status');

		const preview = root.createDiv('mindmap-modal-image-preview');
		const renderPreview = (ref: string): void => {
			preview.empty();
			preview.removeClass('is-error');
			preview.removeClass('is-empty');
			const url = toPreviewUrl(ref);
			if (url) {
				const img = preview.createEl('img');
				img.src = url;
				img.onerror = () => {
					preview.empty();
					preview.setText(t(lang, 'modal.image.loadFailed'));
					preview.addClass('is-error');
				};
			} else {
				preview.setText(t(lang, 'modal.image.none'));
				preview.addClass('is-empty');
			}
		};
		renderPreview(initialRef);

		const setFileStatus = (text: string, isError = false): void => {
			fileStatus.setText(text);
			fileStatus.toggleClass('is-error', isError);
		};

		/** 保存本地文件后，把库内相对路径填入输入框（规范引用） */
		const saveAndApply = async (file: File): Promise<void> => {
			setFileStatus(t(lang, 'modal.image.saving'));
			try {
				const saved = await saveImage(file, MAX_IMAGE_SIZE_MB);
				if (saved) {
					input.value = saved.path;
					renderPreview(saved.path);
					updateStatus(saved.path);
					setFileStatus(`${t(lang, 'modal.image.saved')}${saved.path}`);
				} else {
					setFileStatus(t(lang, 'modal.image.saveFailed'), true);
				}
			} catch (error) {
				setFileStatus(t(lang, 'modal.image.saveFailed'), true);
				console.error('保存图片失败', error);
			}
		};

		fileInput.onchange = async () => {
			const file = fileInput.files?.[0];
			if (file) {
				await saveAndApply(file);
			}
		};

		const pasteFromClipboard = async (): Promise<void> => {
			try {
				const items = await navigator.clipboard.read();
				for (const item of items) {
					const imageType = item.types.find((type) =>
						type.startsWith('image/'),
					);
					if (imageType) {
						const blob = await item.getType(imageType);
						const ext = imageType.split('/')[1] || 'png';
						const file = new File([blob], `clipboard.${ext}`, {
							type: imageType,
						});
						await saveAndApply(file);
						return;
					}
				}
				setFileStatus(t(lang, 'modal.image.noClipboardImage'), true);
			} catch {
				setFileStatus(t(lang, 'modal.image.clipboardError'), true);
			}
		};

		input.addEventListener('input', () => {
			renderPreview(input.value);
			updateStatus(input.value);
		});

		// 库内图片联想：选择后填入库内相对路径
		const vaultImages = app.vault.getFiles().filter((f) => {
			if (f.extension === 'md') {
				return false;
			}
			return isImageExtension(f.extension);
		});
		new ImageFileSuggest(app, input, vaultImages, (file) => {
			input.value = file.path;
			renderPreview(file.path);
			updateStatus(file.path);
		});

		const buttons = root.createDiv();
		buttons.addClass('mindmap-modal-action-row');
		createButton(buttons, t(lang, 'modal.image.clear'), 'muted', () => {
			settle('');
			modal.close();
		});
		createButton(buttons, t(lang, 'modal.cancel'), 'secondary', () => {
			settle(null);
			modal.close();
		});
		createButton(buttons, t(lang, 'modal.confirm'), 'primary', () => {
			settle(input.value.trim());
			modal.close();
		});
		modal.onClose = () => settle(null);
		modal.open();
	});
}
