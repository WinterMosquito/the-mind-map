/**
 * 库内文件解析：把任意输入（路径 / obsidian:// / file:// / 文件名 /
 * 拖拽数据）解析为库内 TFile。从 links.ts 拆出。
 */
import { App, TFile } from 'obsidian';

/**
 * 将任意字符串解析为库内 TFile：
 * 支持库内路径、obsidian:// 链接、file:// 绝对路径、文件名。
 * basename/链接文本形态交由官方 getFirstLinkpathDest 解析（与 Obsidian 内部一致）。
 */
export function resolvePathToFile(
	input: string,
	app: App,
): TFile | null {
	if (!input) {
		return null;
	}
	const text = input.trim();

	if (text.startsWith('obsidian://')) {
		try {
			const fileParam = new URL(text).searchParams.get('file');
			if (fileParam) {
				const path = decodeURIComponent(fileParam);
				let file = app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					return file;
				}
				file = app.vault.getAbstractFileByPath(path + '.md');
				if (file instanceof TFile) {
					return file;
				}
				// 官方链接解析器：basename → 文件（Obsidian 同款同名消歧）
				return app.metadataCache.getFirstLinkpathDest(path, '');
			}
		} catch {
			// 忽略解析错误
		}
		return null;
	}

	let file = app.vault.getAbstractFileByPath(text);
	if (file instanceof TFile) {
		return file;
	}

	if (text.startsWith('file://')) {
		try {
			const decoded = decodeURIComponent(text.replace(/^file:\/\//, ''));
			const vaultName = app.vault.getName();
			const index = decoded.indexOf(vaultName);
			if (index >= 0) {
				const path = decoded.slice(index + vaultName.length + 1);
				file = app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					return file;
				}
			}
		} catch {
			// 路径含未编码 % 等字符时忽略该分支
		}
	}

	// 官方链接解析器（getFirstLinkpathDest）：basename/链接文本 → 文件，
	// 行为与 Obsidian 内部 [[链接]] 解析一致（含大小写、扩展名与同名消歧规则）。
	return app.metadataCache.getFirstLinkpathDest(text, '');
}

/**
 * 从拖拽事件中解析被拖入的库内文件。
 * 依次尝试 text/plain、text/uri-list、其他自定义类型、
 * dataTransfer.files、以及 Obsidian 的 dragManager。
 */
export function resolveDroppedFile(
	dataTransfer: DataTransfer,
	app: App,
): TFile | null {
	// 性能：一次拖拽多次解析，缓存文件列表避免重复扫描
	const allFiles = app.vault.getFiles();
	const plain = dataTransfer.getData('text/plain').trim();
	if (plain) {
		const file = resolvePathToFile(plain, app);
		if (file) {
			return file;
		}
	}

	const uriList = dataTransfer.getData('text/uri-list').trim();
	if (uriList) {
		for (const line of uriList.split('\n')) {
			const item = line.trim();
			if (item.startsWith('file://')) {
				try {
					const decoded = decodeURIComponent(
						item.replace(/^file:\/\//, ''),
					);
					const file = resolvePathToFile(decoded, app);
					if (file) {
						return file;
					}
				} catch {
					// 个别 URL 解码失败，跳过该行
				}
			}
		}
	}

	for (const type of Array.from(dataTransfer.types)) {
		if (type === 'text/plain' || type === 'text/uri-list') {
			continue;
		}
		try {
			const value = dataTransfer.getData(type).trim();
			if (!value) {
				continue;
			}
			const file = resolvePathToFile(value, app);
			if (file) {
				return file;
			}
			if (value.startsWith('{')) {
				try {
					const parsed = JSON.parse(value) as Record<string, unknown>;
					const candidate =
						(parsed['path'] as string) ||
						((parsed['file'] as Record<string, unknown>)?.path as string) ||
						(parsed['filePath'] as string) ||
						(parsed['url'] as string);
					if (candidate) {
						const fileFromJson = resolvePathToFile(candidate, app);
						if (fileFromJson) {
							return fileFromJson;
						}
					}
				} catch {
					// 非 JSON 数据，忽略
				}
			}
		} catch {
			// 某些自定义类型无法读取，忽略
		}
	}

	if (dataTransfer.files.length > 0) {
		const dropped = dataTransfer.files[0];
		if (dropped) {
			const basename = dropped.name.replace(/\.[^.]+$/, '');
			const matches = allFiles.filter(
				(file) => file.name === dropped.name || file.basename === basename,
			);
			// 同名歧义时拒绝解析，避免操作到错误文件
			if (matches.length === 1 && matches[0]) {
				return matches[0];
			}
		}
	}

	try {
		const dragData = (app as unknown as { dragManager?: { dragData?: unknown } })
			.dragManager?.dragData as
			| { path?: string; file?: { path?: string }; files?: { path?: string }[] }
			| undefined;
		if (dragData) {
			const candidate =
				dragData.path ||
				dragData.file?.path ||
				dragData.files?.[0]?.path;
			if (candidate) {
				const file = resolvePathToFile(candidate, app);
				if (file) {
					return file;
				}
			}
		}
	} catch {
		// dragManager 可能不可用
	}

	return null;
}

/**
 * 从拖拽事件的 text/uri-list 中提取真实文件名列表。
 *
 * 修复"拖入附件名乱码"：Windows 下部分来源（微信/QQ、压缩包等）通过
 * 系统 ANSI 代码页提供 File.name，Chromium 解码后得到乱码；而
 * text/uri-list 中的 file:// URL 是 URI 编码的 UTF-8，decode 后可还原
 * 真实文件名。调用方可用本结果替代乱码的 File.name 生成附件名。
 *
 * @returns 与 uri-list 行序一致的真实文件名列表（不含路径）；无法解析时为空数组
 */
export function extractDroppedFileNames(dataTransfer: DataTransfer): string[] {
	const uriList = dataTransfer.getData('text/uri-list');
	if (!uriList) {
		return [];
	}
	const names: string[] = [];
	for (const line of uriList.split('\n')) {
		const item = line.trim();
		if (!item || item.startsWith('#')) {
			continue;
		}
		const pathPart = item.startsWith('file://')
			? item.slice('file://'.length)
			: item;
		try {
			const decoded = decodeURIComponent(pathPart);
			const name = decoded.replace(/\\/g, '/').split('/').pop();
			if (name) {
				names.push(name);
			}
		} catch {
			// 个别 URL 解码失败（如含未编码的 %），跳过该行
		}
	}
	return names;
}
