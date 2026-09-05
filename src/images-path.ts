/**
 * 图片地址处理：外部地址判断、路径解析/序列化、查找索引、树遍历、
 * 节点图片选项与统一尺寸。从 images.ts 拆出。
 */
import { App, TFile, normalizePath } from 'obsidian';
import {
	IMAGE_HEIGHT,
	IMAGE_WIDTH,
	URL_PREFIXES,
} from './constants';
import {
	MindMapTreeNode,
	SetNodeImageOptions,
} from '../vendor/simple-mind-map.cjs';

/** 是否为外部/绝对地址（无需按库内路径解析） */
export function isExternalUrl(url: string): boolean {
	return URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * 将节点数据中的图片地址解析为 Obsidian 可访问的资源地址。
 * 库内相对路径会转换为 vault 资源地址。
 */
export function resolveImagePath(
	url: string,
	app: App,
	allFiles?: TFile[],
): string {
	if (!url || isExternalUrl(url)) {
		return url;
	}
	try {
		const normalized = normalizePath(url);
		const file = app.vault.getAbstractFileByPath(normalized);
		if (file instanceof TFile) {
			return app.vault.getResourcePath(file);
		}
		const name = normalized.split('/').pop() || normalized;
		for (const candidate of allFiles ?? app.vault.getFiles()) {
			if (candidate.name === name) {
				return app.vault.getResourcePath(candidate);
			}
		}
	} catch (error) {
		console.error('解析图片路径失败:', url, error);
	}
	return url;
}

/**
 * 将节点数据中的图片地址序列化回库内路径（保存文件时调用）。
 * 索引一次构建后 O(1) 查询，避免每张图片线性扫描全部文件。
 */
export function serializeImagePath(
	url: string,
	app: App,
	resourceIndex: Map<string, TFile>,
): string {
	if (
		!url ||
		url.startsWith('http://') ||
		url.startsWith('https://') ||
		url.startsWith('data:')
	) {
		return url;
	}
	if (!url.startsWith('file://') && !url.startsWith('app://')) {
		return normalizePath(url);
	}
	try {
		const file = lookupIndexedFile(url, app, resourceIndex);
		if (file) {
			return file.path;
		}
	} catch (error) {
		console.error('序列化图片路径失败:', url, error);
	}
	return url;
}

/** 递归解析树中所有节点的图片/附件地址（加载文件时调用）：库内路径 → 资源地址 */
export function walkResolveImagePaths(tree: MindMapTreeNode, app: App): void {
	// 性能：一次获取库文件列表，避免逐节点全库扫描
	const allFiles = app.vault.getFiles();
	const walk = (node: MindMapTreeNode): void => {
		if (node.data?.image) {
			node.data.image = resolveImagePath(node.data.image, app, allFiles);
		}
		if (node.data?.attachmentUrl) {
			node.data.attachmentUrl = resolveImagePath(
				node.data.attachmentUrl,
				app,
				allFiles,
			);
		}
		node.children?.forEach(walk);
	};
	walk(tree);
}

/** 递归序列化树中所有节点的图片/附件地址（保存文件时调用）：资源地址 → 库内路径 */
export function walkSerializeImagePaths(tree: MindMapTreeNode, app: App): void {
	// 性能：复用全库共享缓存索引（自动保存高频调用，避免每次保存全库重建），
	// 每个节点 O(1) 查询，避免逐节点线性扫描文件并重复计算资源地址。
	const index = getCachedFileLookupIndex(app);
	const walk = (node: MindMapTreeNode): void => {
		if (node.data?.image) {
			node.data.image = serializeImagePath(node.data.image, app, index);
		}
		if (node.data?.attachmentUrl) {
			node.data.attachmentUrl = serializeImagePath(
				node.data.attachmentUrl,
				app,
				index,
			);
		}
		node.children?.forEach(walk);
	};
	walk(tree);
}

/**
 * 构建「多种地址形态 → TFile」的查找索引：
 * - 库内路径（folder/name.ext）
 * - 资源地址（app://...，getResourcePath 输出）
 * - 文件名与 URL 编码文件名
 * - 路径后缀（folder/name.ext，兼容绝对路径/历史数据形态）
 * 一次构建后供整树遍历 / 批量查找 O(1) 复用。
 */
export function buildFileLookupIndex(
	app: App,
	allFiles: TFile[],
): Map<string, TFile> {
	const index = new Map<string, TFile>();
	for (const file of allFiles) {
		index.set(file.path, file);
		const name = file.name;
		index.set(name, file);
		try {
			index.set(encodeURIComponent(name), file);
		} catch {
			// 个别文件名编码失败，跳过该形态
		}
		const segments = file.path.split('/');
		for (let i = 2; i <= segments.length; i++) {
			index.set(segments.slice(-i).join('/'), file);
		}
		try {
			index.set(app.vault.getResourcePath(file), file);
		} catch {
			// 个别文件资源地址计算失败，跳过该形态
		}
	}
	return index;
}

// ---------------------------------------------------------------------------
// 缓存的文件查找索引
//
// 全库构建一次索引需要对每个文件调用 getResourcePath（大库下可达数百毫秒）。
// 而多个高频路径都会触发重建：自动保存（md 图片路径回写）、
// 文件重命名/删除（引用更新）、附件点击/悬浮（findAttachmentFile）。
// 文件列表在 create/rename/delete 事件之外不会变化，因此：
// - 缓存索引按「文件数量」快速比对复用（数量未变且无事件失效 → 直接复用）；
// - main.ts 在 create/rename/delete 事件里调用 invalidateFileLookupIndexCache()
//   显式失效，保证缓存与库一致（修改内容不影响索引，无需失效）。
// 失效后下一次查询（含失效事件的同批处理）会重建，时序上无竞态。
// ---------------------------------------------------------------------------

let cachedFileLookup: Map<string, TFile> | null = null;
let cachedFileLookupCount = 0;

/** 获取（可能缓存的）全库文件查找索引；文件数量变化时自动重建 */
export function getCachedFileLookupIndex(app: App): Map<string, TFile> {
	const files = app.vault.getFiles();
	if (cachedFileLookup && cachedFileLookupCount === files.length) {
		return cachedFileLookup;
	}
	cachedFileLookup = buildFileLookupIndex(app, files);
	cachedFileLookupCount = files.length;
	return cachedFileLookup;
}

/** 库文件列表变化（create/rename/delete）后使缓存失效 */
export function invalidateFileLookupIndexCache(): void {
	cachedFileLookup = null;
	cachedFileLookupCount = 0;
}

/**
 * 通过索引把任意地址形态解析为库内 TFile（O(1)，索引缺失键时按后缀回退）。
 * 外部地址（http/data/blob）返回 null。
 */
export function lookupIndexedFile(
	url: string,
	app: App,
	index: Map<string, TFile>,
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
		const byPath = app.vault.getAbstractFileByPath(normalizePath(url));
		if (byPath instanceof TFile) {
			return byPath;
		}
		for (const candidate of uniqueCandidates(url)) {
			const hit = index.get(candidate);
			if (hit) {
				return hit;
			}
			const segments = candidate.replace(/\\/g, '/').split('/');
			for (let i = 1; i <= segments.length; i++) {
				const suffixHit = index.get(segments.slice(-i).join('/'));
				if (suffixHit) {
					return suffixHit;
				}
			}
		}
	} catch (error) {
		console.error('解析附件文件失败:', url, error);
	}
	return null;
}

/** 原样地址 + URL 解码地址（去重）作为索引查询候选 */
function uniqueCandidates(url: string): string[] {
	const candidates = [url];
	try {
		const decoded = decodeURIComponent(url);
		if (decoded !== url) {
			candidates.push(decoded);
		}
	} catch {
		// 含未编码 % 等字符时仅用原样地址
	}
	return candidates;
}

/** 生成统一的 SET_NODE_IMAGE 参数 */
export function createSetNodeImageOptions(url: string | null): SetNodeImageOptions {
	if (url === null || url === '') {
		return { url: null, title: '', width: 0, height: 0, custom: false };
	}
	return {
		url,
		title: '',
		width: IMAGE_WIDTH,
		height: IMAGE_HEIGHT,
		custom: false,
	};
}

// ---------------------------------------------------------------------------
// 按图片原始比例计算展示尺寸
//
// 需求：含图片节点的外框比例跟随图片自身比例——所有图片高度统一
// （IMAGE_HEIGHT），宽度按各自宽高比计算（宽度 = 高度 × 原始宽高比），
// 节点内同时含文字时由引擎布局自动把文字放在图片下方并增加外框高度
// （imgPlacement: top + imgTextMargin）。
// ---------------------------------------------------------------------------

/** 图片尺寸探测超时（毫秒）：加载失败/挂起时不阻塞渲染 */
const IMAGE_PROBE_TIMEOUT_MS = 2500;

/**
 * 图片自然尺寸探测缓存（url → 原始尺寸，仅缓存成功结果）。
 * 同一导图重复打开、同图多节点引用时避免重复 new Image() 解码探测。
 */
const IMAGE_SIZE_CACHE = new Map<string, { width: number; height: number }>();
/** 缓存上限（按插入序近似 LRU，超出时淘汰最早条目） */
const IMAGE_SIZE_CACHE_MAX = 500;

function cacheImageSize(
	url: string,
	size: { width: number; height: number },
): void {
	IMAGE_SIZE_CACHE.set(url, size);
	if (IMAGE_SIZE_CACHE.size > IMAGE_SIZE_CACHE_MAX) {
		const oldest = IMAGE_SIZE_CACHE.keys().next().value;
		if (oldest !== undefined) {
			IMAGE_SIZE_CACHE.delete(oldest);
		}
	}
}

/**
 * 探测图片原始尺寸（自然宽高）。
 * 通过独立 Image 对象加载（不影响画布上的图片元素）；失败、非法或超时返回 null。
 * 命中缓存时同步返回（Promise 解析），不重新解码。
 */
export function probeImageNaturalSize(
	url: string,
): Promise<{ width: number; height: number } | null> {
	return new Promise((resolve) => {
		if (!url) {
			resolve(null);
			return;
		}
		const cached = IMAGE_SIZE_CACHE.get(url);
		if (cached) {
			resolve({ ...cached });
			return;
		}
		const img = new Image();
		let settled = false;
		const timer = window.setTimeout(() => settle(null), IMAGE_PROBE_TIMEOUT_MS);
		const settle = (
			value: { width: number; height: number } | null,
		): void => {
			if (settled) {
				return;
			}
			settled = true;
			window.clearTimeout(timer);
			img.onload = null;
			img.onerror = null;
			resolve(value);
		};
		img.onload = () => {
			if (img.naturalWidth > 0 && img.naturalHeight > 0) {
				const size = { width: img.naturalWidth, height: img.naturalHeight };
				cacheImageSize(url, size);
				settle(size);
			} else {
				settle(null);
			}
		};
		img.onerror = () => settle(null);
		img.src = url;
	});
}

/**
 * 按图片自身宽高比计算展示尺寸：高度统一为 targetHeight（默认 IMAGE_HEIGHT），
 * 宽度 = 高度 × 原始宽高比（取整，最小 1px）。
 * 探测失败（外部图片无法加载等）时回退到固定尺寸（custom:false，引擎自行约束）。
 */
export async function computeAspectImageSize(
	url: string,
	targetHeight = IMAGE_HEIGHT,
): Promise<{ width: number; height: number; custom: boolean }> {
	const natural = await probeImageNaturalSize(url);
	if (natural && natural.height > 0) {
		return {
			width: Math.max(
				1,
				Math.round((targetHeight * natural.width) / natural.height),
			),
			height: targetHeight,
			custom: true,
		};
	}
	return { width: IMAGE_WIDTH, height: targetHeight, custom: false };
}

/** 生成统一的 SET_NODE_IMAGE 参数：按图片原始比例、统一高度（custom:true 不裁切） */
export async function createAspectSetNodeImageOptions(
	url: string | null,
): Promise<SetNodeImageOptions> {
	if (url === null || url === '') {
		return createSetNodeImageOptions(null);
	}
	const size = await computeAspectImageSize(url);
	return {
		url,
		title: '',
		width: size.width,
		height: size.height,
		custom: size.custom,
	};
}

/**
 * 递归按图片原始比例校正树内所有图片尺寸（并发探测）。
 * 返回是否有修改；探测失败的图片保持默认尺寸。
 */
export async function walkCorrectImageSizesByAspect(
	tree: MindMapTreeNode,
): Promise<boolean> {
	const nodes: MindMapTreeNode[] = [];
	const collect = (node: MindMapTreeNode): void => {
		if (node.data?.image) {
			nodes.push(node);
		}
		node.children?.forEach(collect);
	};
	collect(tree);
	let changed = false;
	await Promise.all(
		nodes.map(async (node) => {
			const size = await computeAspectImageSize(node.data?.image ?? '');
			const current = node.data?.imageSize;
			if (
				!current ||
				current.width !== size.width ||
				current.height !== size.height ||
				current.custom !== size.custom
			) {
				node.data.imageSize = size;
				changed = true;
			}
		}),
	);
	return changed;
}

/**
 * 递归规范化树中所有节点的图片尺寸为统一固定值（需求 1）。
 * 加载与保存时都会调用，保证新旧文件中的图片都以固定高度完整呈现。
 */
export function normalizeImageSizes(tree: MindMapTreeNode): void {
	const walk = (node: MindMapTreeNode): void => {
		if (node.data?.image) {
			node.data.imageSize = {
				width: IMAGE_WIDTH,
				height: IMAGE_HEIGHT,
				custom: false,
			};
		}
		node.children?.forEach(walk);
	};
	walk(tree);
}
