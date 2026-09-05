/**
 * 节点图片全屏查看（灯箱）。
 * 点击节点图片（引擎 node_img_click）或右键菜单「全屏查看图片」时，
 * 以铺满整个窗口的灯箱展示图片；点击任意位置或按 ESC 关闭，滚轮缩放。
 * 基于 Obsidian Modal 实现：组件生命周期（打开/关闭/清理）由 Obsidian 管理。
 */
import { App, Modal } from 'obsidian';
import { t, type Language } from './i18n';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapView } from './view';

/** 打开节点图片的全屏查看（灯箱）；节点无图片时不动作 */
export function openNodeImageFullscreen(
	view: MindMapView,
	node: MindMapNode,
): void {
	const url = (node.getData?.('image') as string) || '';
	if (!url) {
		return;
	}
	const title = (node.getData?.('imageTitle') as string) || '';
	new NodeImageLightboxModal(view.app, url, title, view.lang).open();
}

/** 全屏图片灯箱弹窗 */
class NodeImageLightboxModal extends Modal {
	constructor(
		app: App,
		private url: string,
		private imageTitle: string,
		private lang: Language,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('mindmap-image-lightbox');
		const wrap = contentEl.createDiv('mindmap-image-lightbox-content');
		const img = wrap.createEl('img');
		img.alt = this.imageTitle || t(this.lang, 'nodeImage.alt');
		img.src = this.url;
		// 灯箱惯例：点击图片任意位置关闭
		wrap.onclick = () => this.close();
		// 滚轮缩放（以图片中心为缩放原点）
		let scale = 1;
		wrap.addEventListener(
			'wheel',
			(event) => {
				event.preventDefault();
				const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
				scale = Math.min(5, Math.max(0.2, scale * factor));
				img.style.transform = `scale(${scale})`;
			},
			{ passive: false },
		);
		// 图片加载失败时给出提示，避免显示破图
		img.onerror = () => {
			wrap.empty();
			wrap.setText(t(this.lang, 'modal.image.loadFailed'));
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
