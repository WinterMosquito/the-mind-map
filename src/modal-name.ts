/**
 * 新建文件名称输入弹窗（需求 2）：
 * 创建时允许用户直接修改文件名（预填默认名，全选便于改写）。
 * @returns 输入的名称（已去除首尾空白）；取消返回 null
 * 从 modals.ts 拆出。
 */
import { App, Modal } from 'obsidian';
import { t, type Language } from './i18n';
import { createButton } from './modal-common';

export function openNameInputModal(
	app: App,
	defaultValue: string,
	folderPath: string,
	lang: Language,
): Promise<string | null> {
	return new Promise((resolve) => {
		// settle 守卫 + onClose 兜底：点击遮罩等非按钮路径关闭时
		// Promise 也必然 resolve，避免调用方 await 永久挂起。
		let settled = false;
		const settle = (value: Parameters<typeof resolve>[0]): void => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(value);
		};
		const modal = new Modal(app);
		modal.titleEl.setText(t(lang, 'command.createMindMap'));
		const root = modal.contentEl.createDiv('mindmap-name-editor');

		const hint = root.createDiv();
		hint.setText(`${t(lang, 'modal.name.folder')}${folderPath || '/'}`);
		hint.addClass('mindmap-modal-muted-hint');

		const input = root.createEl('input', {
			cls: 'mindmap-modal-input',
			attr: { type: 'text', value: defaultValue, spellcheck: 'false' },
		});
		input.focus();
		input.select(); // 全选，便于直接输入新名称

		const confirm = (): void => {
			const name = input.value.trim();
			if (!name) {
				input.focus();
				return;
			}
			// 先 settle 再 close：Obsidian 的 Modal.close() 会同步触发 onClose（兜底
			// settle(null)），若先 close 则 onClose 的 settle(null) 会抢先 resolve(null)，
			// 导致用户输入的名称被当作取消、导图不创建。与 modal-note.ts 的正确顺序一致。
			settle(name);
			modal.close();
		};
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				confirm();
			} else if (event.key === 'Escape') {
				settle(null);
				modal.close();
			}
		});

		const buttons = root.createDiv();
		buttons.addClass('mindmap-modal-action-row', 'mindmap-modal-action-row--mt');
		createButton(buttons, t(lang, 'modal.cancel'), 'secondary', () => {
			settle(null);
			modal.close();
		});
		createButton(buttons, t(lang, 'modal.confirm'), 'primary', confirm);
		// 兜底：用户按 Esc 或任何非按钮路径关闭弹窗时，避免 Promise 永不 resolve
		modal.onClose = () => settle(null);
		modal.open();
	});
}
