/**
 * 节点链接编辑弹窗（与 Obsidian 双链对齐）：
 * - 联想库内 Markdown 笔记与附件文件（音/视/PDF），官方 AbstractInputSuggest
 *   提供浮层、键盘导航与模糊提示；
 * - 支持直接输入 http(s)/obsidian:// 外部或协议链接；
 * - 返回 { link, label }：link 为写入 md 的链接文本（[[..]] 或 url），
 *   label 为可见文本（笔记名/别名/文件名），供导图节点文本对齐。
 */
import {
	App,
	Modal,
	AbstractInputSuggest,
	TFile,
	setIcon,
} from 'obsidian';
import { t, type Language } from './i18n';
import { createButton } from './modal-common';
import {
	isExternalOrProtocolUrl,
	isLinkAttachmentExtension,
} from './constants';

export interface LinkPickResult {
	/** 链接文本（写入 md：[[..]] 或 url/obsidian://） */
	link: string;
	/** 可见文本（用于节点文本；URL 输入时为 undefined） */
	label?: string;
}

/** 联想候选：md 笔记或可链接附件 */
class NoteLinkSuggest extends AbstractInputSuggest<TFile> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private notes: TFile[],
		private attachments: TFile[],
		private onChoose: (file: TFile, isNote: boolean) => void,
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFile[] {
		const keyword = query.toLowerCase().trim();
		if (!keyword) {
			return [];
		}
		const result: TFile[] = [];
		const push = (files: TFile[]): void => {
			for (const file of files) {
				if (file.basename.toLowerCase().includes(keyword)) {
					result.push(file);
					if (result.length >= 20) {
						return;
					}
				}
			}
		};
		push(this.notes);
		push(this.attachments);
		return result;
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		const isNote = file.extension === 'md';
		const icon = el.createSpan({
			cls: 'mindmap-link-suggest-icon',
		});
		setIcon(icon, isNote ? 'file-text' : 'file');
		el.createSpan({
			text: isNote ? file.basename : file.name,
		});
		const path = el.createSpan({ cls: 'note-path', text: file.parent?.path ?? '' });
		path.addClass('mindmap-link-suggest-path');
	}

	selectSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(file, file.extension === 'md');
	}
}

export function openLinkEditorModal(
	app: App,
	current: string,
	lang: Language,
): Promise<LinkPickResult | null> {
	return new Promise((resolve) => {
		let settled = false;
		const settle = (value: LinkPickResult | null): void => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(value);
		};
		const modal = new Modal(app);
		modal.titleEl.setText(t(lang, 'modal.link.title'));
		const root = modal.contentEl.createDiv('mindmap-link-editor');
		const input = root.createEl('input', {
			cls: 'mindmap-link-input mindmap-modal-input',
			attr: {
				type: 'text',
				placeholder: t(lang, 'modal.link.placeholder'),
				value: current,
			},
		});
		input.focus();

		const markdownFiles = app.vault.getMarkdownFiles();
		const allFiles = app.vault.getFiles();
		const attachments = allFiles.filter(
			(f) => f.extension !== 'md' && isLinkAttachmentExtension(f.extension),
		);

		/** 把输入原样作为结果（URL / obsidian:// / 自定义） */
		const commitRaw = (value: string): void => {
			const v = value.trim();
			if (!v) {
				settle(null);
				modal.close();
				return;
			}
			settle(isExternalOrProtocolUrl(v) ? { link: v } : { link: v });
			modal.close();
		};

		new NoteLinkSuggest(app, input, markdownFiles, attachments, (file, isNote) => {
			if (isNote) {
				const unique =
					markdownFiles.filter((f) => f.basename === file.basename)
						.length === 1;
				// 同名笔记用路径消歧（Obsidian 双链 [[路径/名|名]] 语义）
				settle(
					unique
						? { link: `[[${file.basename}]]`, label: file.basename }
						: {
								link: `[[${file.path}|${file.basename}]]`,
								label: file.basename,
							},
				);
			} else {
				// 附件：完整库内路径链接（保留扩展名可见）
				settle({ link: `[[${file.path}]]`, label: file.name });
			}
			modal.close();
		});

		// 联想浮层未打开时 Enter 直接提交原始输入
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				commitRaw(input.value);
			}
		});

		const buttons = root.createDiv();
		buttons.addClass('mindmap-modal-action-row', 'mindmap-modal-action-row--mt');
		createButton(buttons, t(lang, 'modal.link.clear'), 'muted', () => {
			settle({ link: '' });
			modal.close();
		});
		createButton(buttons, t(lang, 'modal.cancel'), 'secondary', () => {
			settle(null);
			modal.close();
		});
		createButton(buttons, t(lang, 'modal.confirm'), 'primary', () => {
			commitRaw(input.value);
		});
		// 兜底：Esc / 非按钮路径关闭时 Promise 必然 resolve
		modal.onClose = () => settle(null);
		modal.open();
	});
}
