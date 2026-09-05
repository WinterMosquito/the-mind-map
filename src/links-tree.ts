/**
 * 思维导图树引用更新：文件重命名/删除后，同步树内图片与 [[链接]] 引用。
 * 从 links.ts 拆出。
 */
import { App, TFile } from 'obsidian';
import { getCachedFileLookupIndex } from './images';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';

/** Obsidian 库内回收站目录（vault 根下的 .trash） */
const TRASH_DIR = '.trash';

/**
 * 判断导图树是否含任何图片、附件或超链接节点。
 * 文件重命名/删除的引用更新前先短路：纯文本导图无需建索引、无需遍历。
 */
function treeHasImageOrAttachmentOrLink(tree: MindMapTreeNode): boolean {
	let found = false;
	const walk = (node: MindMapTreeNode): void => {
		if (found) {
			return;
		}
		if (
			node.data?.image ||
			node.data?.attachmentUrl ||
			node.data?.hyperlink
		) {
			found = true;
			return;
		}
		node.children?.forEach(walk);
	};
	walk(tree);
	return found;
}

/**
 * 地址比对形态：原样 + URL 解码。
 * 节点里存的是资源地址（app://...），Obsidian 对中文/空格等文件名会做
 * URL 编码；直接与原始文件名比较会失配，导致"删除附件后节点不更新"。
 */
function urlComparisonForms(url: string): string[] {
	const forms = [url];
	try {
		const decoded = decodeURIComponent(url);
		if (decoded !== url) {
			forms.push(decoded);
		}
	} catch {
		// 个别地址含未编码的 %，仅用原样形态
	}
	return forms;
}

/**
 * 判断节点存储的地址是否指向指定文件（文件删除/回收场景）。
 * 支持库内路径、资源地址（app://）、裸文件名等历史形态；
 * 路径按相等/后缀匹配，文件名按地址最后一段精确匹配
 * （避免 `a.png` 这类短名误命中 `ba.png` 的后缀）。
 */
function urlRefersToFile(url: string, file: TFile): boolean {
	const paths = [file.path, file.path.replace(/\.md$/, '')];
	for (const form of urlComparisonForms(url)) {
		for (const path of paths) {
			if (form === path || form.endsWith(path)) {
				return true;
			}
		}
		const lastSegment = form.split('/').pop() ?? '';
		if (
			lastSegment === file.name ||
			lastSegment === encodeURIComponent(file.name)
		) {
			return true;
		}
	}
	return false;
}

/**
 * 判断节点存储的地址是否指向旧路径/旧文件名（文件重命名/移入回收站场景）。
 * 与 urlRefersToFile 相同的匹配策略，但以旧路径与旧文件名为准。
 */
function urlRefersToOldFile(
	url: string,
	oldPath: string,
	file: TFile,
): boolean {
	const oldBasename = (oldPath.split('/').pop() ?? '').replace(
		/\.[^.]+$/,
		'',
	);
	const paths = [oldPath, oldPath.replace(/\.md$/, '')];
	for (const form of urlComparisonForms(url)) {
		for (const path of paths) {
			if (form === path || form.endsWith(path)) {
				return true;
			}
		}
		const lastSegment = form.split('/').pop() ?? '';
		for (const name of [file.name, oldBasename]) {
			if (
				lastSegment === name ||
				lastSegment === encodeURIComponent(name)
			) {
				return true;
			}
		}
	}
	return false;
}

/**
 * 文件重命名后，更新思维导图树中对旧文件的引用（图片、附件与 [[链接]]）。
 * 返回是否有变更。
 *
 * 特殊场景：文件被移入 Obsidian 库内回收站（.trash/）——用户视角是"删除"，
 * 此时应清除树内对旧路径的引用，而不是把引用改指向回收站位置
 * （否则节点会继续显示"已删除"的附件/图片，直到重新打开才更新）。
 */
export function updateReferencesOnRename(
	tree: MindMapTreeNode,
	file: TFile,
	oldPath: string,
	app: App,
): boolean {
	// 短路：纯文本导图（无图片/附件/链接）无需建索引、无需遍历整树
	if (!treeHasImageOrAttachmentOrLink(tree)) {
		return false;
	}
	// 性能：复用全库共享缓存索引（文件重命名事件高频触发，避免每次全库重建）
	const resourceIndex = getCachedFileLookupIndex(app);
	const trashed =
		file.path === TRASH_DIR || file.path.startsWith(`${TRASH_DIR}/`);
	let changed = false;
	const walk = (node: MindMapTreeNode): void => {
		if (node.data?.image) {
			const imagePath = serializeImagePathForCompare(
				node.data.image,
				resourceIndex,
			);
			if (urlRefersToOldFile(imagePath, oldPath, file)) {
				node.data.image = trashed ? '' : app.vault.getResourcePath(file);
				changed = true;
			}
		}
		if (node.data?.attachmentUrl) {
			const attachmentPath = serializeImagePathForCompare(
				node.data.attachmentUrl,
				resourceIndex,
			);
			if (urlRefersToOldFile(attachmentPath, oldPath, file)) {
				node.data.attachmentUrl = trashed
					? ''
					: app.vault.getResourcePath(file);
				node.data.attachmentName = trashed ? '' : file.name;
				changed = true;
			}
		}
		if (node.data?.hyperlink) {
			const link = node.data.hyperlink;
			if (link.startsWith('[[')) {
				const inner = link.slice(2, -2);
				// 目标部分是第一个 | 或 # 之前的内容（支持 [[路径#区块|别名]]）
				const firstSep = inner.search(/[|#]/);
				const target =
					firstSep === -1 ? inner : inner.slice(0, firstSep);
				const oldBasename =
					oldPath.split('/').pop()?.replace(/\.md$/, '') ?? '';
				const oldPathNoExt = oldPath.replace(/\.md$/, '');
				// 兼容 [[note]] 与全路径 [[folder/note]]（后者无 .md 扩展名）
				if (
					target === oldBasename ||
					target === oldPath ||
					target === oldPathNoExt
				) {
					if (trashed) {
						// 移入回收站等同删除：清除链接
						node.data.hyperlink = '';
					} else {
						// 仅替换链接目标，保留 #区块 / |别名 等尾巴
						const rest = firstSep === -1 ? '' : inner.slice(firstSep);
						// 保留路径前缀：[[folder/新名]]；无前缀时用裸 basename
						const prefix = target.includes('/')
							? target.split('/').slice(0, -1).join('/')
							: '';
						const newTarget = prefix
							? `${prefix}/${file.basename}`
							: file.basename;
						node.data.hyperlink = `[[${newTarget}${rest}]]`;
					}
					changed = true;
				}
			}
		}
		node.children?.forEach(walk);
	};
	walk(tree);
	return changed;
}

/** 通过索引把资源地址还原为库内路径（O(1)） */
function serializeImagePathForCompare(
	url: string,
	index: Map<string, TFile>,
): string {
	const file = index.get(url);
	return file ? file.path : url;
}

/**
 * 文件删除后，清除思维导图树中对它的引用（图片、附件与 [[链接]]）。
 * 返回是否有变更。
 */
export function removeReferencesOnDelete(
	tree: MindMapTreeNode,
	file: TFile,
	app: App,
): boolean {
	// 短路：纯文本导图（无图片/附件/链接）无需建索引、无需遍历整树
	if (!treeHasImageOrAttachmentOrLink(tree)) {
		return false;
	}
	// 性能：复用全库共享缓存索引（文件删除事件高频触发，避免每次全库重建）
	const resourceIndex = getCachedFileLookupIndex(app);
	let changed = false;
	const walk = (node: MindMapTreeNode): void => {
		if (node.data?.image) {
			const imagePath = serializeImagePathForCompare(
				node.data.image,
				resourceIndex,
			);
			if (urlRefersToFile(imagePath, file)) {
				node.data.image = '';
				changed = true;
			}
		}
		if (node.data?.attachmentUrl) {
			const attachmentPath = serializeImagePathForCompare(
				node.data.attachmentUrl,
				resourceIndex,
			);
			if (urlRefersToFile(attachmentPath, file)) {
				node.data.attachmentUrl = '';
				node.data.attachmentName = '';
				changed = true;
			}
		}
		if (node.data?.hyperlink) {
			const link = node.data.hyperlink;
			if (link.startsWith('[[')) {
				const inner = link.slice(2, -2);
				const target = inner.split('|')[0]?.split('#')[0] ?? '';
				// 兼容 [[note]] 与全路径 [[folder/note]]（后者无 .md 扩展名）
				if (
					target === file.basename ||
					target === file.path ||
					target === file.path.replace(/\.md$/, '')
				) {
					node.data.hyperlink = '';
					changed = true;
				}
			}
		}
		node.children?.forEach(walk);
	};
	walk(tree);
	return changed;
}
