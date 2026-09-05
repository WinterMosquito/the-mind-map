/**
 * 导出子系统：PNG / Markdown 导出与下载工具。
 * （导出 JSON / 导入 JSON 已随专有格式支持删除）
 */
import { Notice } from 'obsidian';
import { t } from './i18n';
import type { MindMapView } from './view';

const FALLBACK_NAME = 'mindmap';

/** 导出为 PNG 文件（遵循导出倍率设置） */
export async function exportPNG(view: MindMapView): Promise<void> {
	if (!view.mindMap) {
		return;
	}
	const mindMapAny = view.mindMap as unknown as {
		opt?: Record<string, unknown>;
	};
	const oldScale = mindMapAny.opt?.minExportImgCanvasScale;
	try {
		const exporter = view.mindMap.doExport;
		if (!exporter?.export) {
			return;
		}
		view.mindMap.updateConfig({
			minExportImgCanvasScale: view.plugin.settings.exportScale,
		});
		const result = await exporter.export(
			'png',
			false,
			view.file?.basename ?? FALLBACK_NAME,
		);
		if (result) {
			const fileName = `${view.file?.basename ?? FALLBACK_NAME}.png`;
			if (result instanceof Blob) {
				downloadBlob(result, fileName);
			} else if (typeof result === 'string') {
				downloadDataURL(result, fileName);
			}
		}
	} catch (error) {
		new Notice(
			`${t(view.lang, 'export.pngFailed')}${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		// 导出后恢复临时改动的导出倍率，避免残留到后续渲染/其它导出
		if (oldScale !== undefined) {
			view.mindMap.updateConfig({ minExportImgCanvasScale: oldScale });
		} else if (mindMapAny.opt) {
			delete mindMapAny.opt.minExportImgCanvasScale;
		}
	}
}

/** 触发浏览器下载一个 Blob（延迟回收 URL，避免中断下载） */
function downloadBlob(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = createEl('a');
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 触发浏览器下载一个 data URL */
function downloadDataURL(url: string, fileName: string): void {
	const anchor = createEl('a');
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
}
