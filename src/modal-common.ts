/**
 * 弹窗共享件：官方 ButtonComponent 封装。
 * 被各 modal-*.ts 弹窗模块共用（从 modals.ts 拆出）。
 */
import { ButtonComponent } from 'obsidian';

export type ButtonVariant = 'primary' | 'secondary' | 'muted';

/**
 * 创建 Obsidian 官方按钮组件（主题一致、含可达性处理）。
 * primary 用 CTA 强调色；muted 为弱化操作（.is-muted 降饱和）。
 */
export function createButton(
	container: HTMLElement,
	text: string,
	variant: ButtonVariant,
	onClick: () => void,
): ButtonComponent {
	const button = new ButtonComponent(container);
	button.setButtonText(text);
	if (variant === 'primary') {
		button.setCta();
	} else if (variant === 'muted') {
		button.buttonEl.addClass('is-muted');
	}
	button.onClick(onClick);
	return button;
}
