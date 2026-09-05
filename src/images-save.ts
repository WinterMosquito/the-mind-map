/**
 * 图片保存与查找：图片文件入库（遵循附件存放位置规则）、
 * 文件名清理、图片地址解析回库内文件。从 images.ts 拆出。
 */
import { App, Notice, TFile, normalizePath } from 'obsidian';
import { isImageExtension } from './constants';
import { getCachedFileLookupIndex, lookupIndexedFile } from './images-path';
import { t, type Language } from './i18n';

/**
 * 保存串行链：「文件名选择 + 写入」必须整体互斥。
 * 两个并发保存同名图片若各自通过存在性检查再分别 createBinary，
 * 会写同一目标（TOCTOU，后写覆盖先写）。链上排队保证原子性。
 */
let saveImageChain: Promise<unknown> = Promise.resolve();

/** 清理文件名中的非法字符（含控制字符） */
export function sanitizeFileName(name: string): string {
	let result = '';
	for (const char of name) {
		const code = char.charCodeAt(0);
		result += code < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char;
	}
	return result;
}

/**
 * 按 Unicode 码点截断文本。
 * 直接用 slice 会把 emoji 等代理对（surrogate pair）切成半个字符，
 * 落到文件名里就是乱码。
 */
function truncateByCodePoint(text: string, max: number): string {
	const chars = Array.from(text);
	return chars.length <= max ? text : chars.slice(0, max).join('');
}

/**
 * 宽松兜底匹配：URL 解码后是否等于库内路径或以库内路径结尾。
 * 历史数据中可能保存了 file:// 绝对路径、URL 编码路径等形态。
 */
function matchesDecodedPath(url: string, file: TFile): boolean {
	try {
		const decoded = decodeURIComponent(url);
		return decoded === file.path || decoded.endsWith(`/${file.path}`);
	} catch {
		return false;
	}
}

/**
 * 将图片文件保存到库的附件目录。
 * 存储路径遵循 Obsidian 系统设置中的"附件存放位置"规则
 * （通过 `fileManager.getAvailablePathForAttachment` 获取）。
 * @param app           Obsidian App 实例
 * @param sourcePath    当前思维导图文件路径（用于确定附件目录）
 * @param file          要保存的图片文件
 * @param maxSizeMB     大小上限（MB）
 * @param preferredName 可选真实文件名（text/uri-list 解码，修复乱码）
 * @returns 保存后的 TFile；失败时返回 null 并弹提示
 */
export function saveImageToVault(
	app: App,
	sourcePath: string,
	file: File,
	maxSizeMB = 10,
	preferredName?: string,
	lang: Language = 'zh',
): Promise<TFile | null> {
	const run = saveImageChain.then(() =>
		saveImageToVaultInner(
			app,
			sourcePath,
			file,
			maxSizeMB,
			preferredName,
			lang,
		),
	);
	// 无论本次成败都推进队列（错误已在内部处理并返回 null）
	saveImageChain = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

async function saveImageToVaultInner(
	app: App,
	sourcePath: string,
	file: File,
	maxSizeMB = 10,
	preferredName?: string,
	lang: Language = 'zh',
): Promise<TFile | null> {
	const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
	const isImage = file.type.startsWith('image/') || isImageExtension(ext);
	if (!isImage) {
		new Notice(t(lang, 'attachment.chooseImage'));
		return null;
	}
	const maxBytes = maxSizeMB * 1024 * 1024;
	if (file.size > maxBytes) {
		const sizeMB = (file.size / 1024 / 1024).toFixed(1);
		new Notice(
			t(lang, 'attachment.tooLarge')
				.replace('{size}', sizeMB)
				.replace('{max}', String(maxSizeMB)),
		);
		return null;
	}
	try {
		// 文件名选择与乱码修复：
		// 1. 默认用 File.name（用户拖入文件的真实原名，如「冬天.jpeg」）；
		// 2. 仅当 File.name 含乱码标志 U+FFFD（部分 Windows 来源被系统 ANSI
		//    代码页错误解码）时，才改用 preferredName（text/uri-list 解码名）；
		//    避免 preferredName 在个别来源中被错误转写而覆盖用户原名；
		// 3. 按 Unicode 码点截断，避免把 emoji 等代理对切成乱码。
		const needsNameFix = file.name.includes('\uFFFD');
		const rawName = needsNameFix && preferredName ? preferredName : file.name;
		const safeName = rawName.includes('\uFFFD') ? '' : rawName;
		const baseName = sanitizeFileName(
			truncateByCodePoint(
				safeName.replace(/\.[^.]+$/, '') || 'image',
				50,
			),
		);
		// 文件名保持原名（不加时间戳/随机后缀）；
		// 遵循系统「附件存放位置」设置：必须传入 sourcePath。
		const fileName = `${baseName}.${ext}`;
		let availablePath = normalizePath(
			await app.fileManager.getAvailablePathForAttachment(
				fileName,
				sourcePath,
			),
		);
		// 重名兜底：目标已存在时按 Obsidian 惯例追加序号（"名称 1"、"名称 2"…）。
		// 不依赖 getAvailablePathForAttachment 的具体重名策略，
		// 也避免并发/历史同名文件被覆盖。
		let retry = 0;
		while (app.vault.getAbstractFileByPath(availablePath) && retry < 100) {
			retry++;
			availablePath = normalizePath(
				await app.fileManager.getAvailablePathForAttachment(
					`${baseName} ${retry}.${ext}`,
					sourcePath,
				),
			);
		}
		const targetPath = normalizePath(availablePath);
		const folder = targetPath.substring(0, targetPath.lastIndexOf('/'));
		if (folder && !app.vault.getAbstractFileByPath(folder)) {
			try {
				await app.vault.createFolder(folder);
			} catch {
				// 目录已存在等情况忽略
			}
		}
		const data = await file.arrayBuffer();
		return await app.vault.createBinary(targetPath, data);
	} catch (error) {
		console.error('保存图片失败', error);
		new Notice(
			`${t(lang, 'attachment.saveFailed')}${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return null;
	}
}

/**
 * 将节点中的图片/附件地址解析回库内 TFile。
 * 支持库内路径与资源地址（app://...）；外部地址返回 null。
 * 性能：先走全库共享缓存索引 O(1) 查询（附件点击/悬浮高频路径），
 * 索引未命中（罕见形态）才回退线性扫描。
 * @param allFiles 可选：调用方缓存的库文件列表（避免重复 getFiles）
 */
export function findAttachmentFile(
	app: App,
	url: string,
	allFiles?: TFile[],
): TFile | null {
	if (
		!url ||
		url.startsWith('http://') ||
		url.startsWith('https://') ||
		url.startsWith('data:') ||
		url.startsWith('blob:')
	) {
		return null;
	}
	try {
		// 库内路径（权威、始终最新）
		const byPath = app.vault.getAbstractFileByPath(normalizePath(url));
		if (byPath instanceof TFile) {
			return byPath;
		}
		// 快速路径：共享缓存索引（资源地址/文件名/路径后缀等形态 O(1)）
		const hit = lookupIndexedFile(url, app, getCachedFileLookupIndex(app));
		if (hit) {
			return hit;
		}
		// 兜底：线性扫描（兼容索引未覆盖的历史/异常形态）
		for (const file of allFiles ?? app.vault.getFiles()) {
			if (
				app.vault.getResourcePath(file) === url ||
				url.endsWith(encodeURIComponent(file.name)) ||
				matchesDecodedPath(url, file) ||
				url.split(/[\\/]/).pop() === file.name
			) {
				return file;
			}
		}
	} catch (error) {
		console.error('解析图片文件失败:', url, error);
	}
	return null;
}
