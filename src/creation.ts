/**
 * 新建思维导图（Markdown 渲染模式）：创建 `.mindmap.md` 文件。
 *
 * 渲染层定位：新文件是标准 Markdown 大纲（frontmatter 可选 + # 标题 + 列表），
 * 双击/链接打开落在 Obsidian markdown 视图；本模块负责流程（命名、落盘、打开），
 * 并在创建后自动把当前标签切换到导图视图（openAsMindMap）。
 */
import { App, Notice, normalizePath } from 'obsidian';
import { MD_FILE_SUFFIX } from './constants';
import { t, type Language } from './i18n';
import { buildDefaultMindMapName, createDefaultMarkdownContent } from './markdown';
import { openAsMindMap } from './md-open';
import { openNameInputModal } from './modals';

/** 保证用户输入以 .mindmap.md 结尾（容忍误输入 .mindmap / .mindmap.md） */
function withMdSuffix(name: string): string {
	if (MD_FILE_SUFFIX_RE.test(name)) {
		return name;
	}
	if (/\.mindmap$/i.test(name)) {
		return `${name}.md`;
	}
	return `${name}${MD_FILE_SUFFIX}`;
}

const MD_FILE_SUFFIX_RE = /\.mindmap\.md$/i;

/**
 * 新建思维导图（需求：新建应为 Markdown 文件而非专有格式）：
 * 默认名称「思维导图+当前日期」（如 思维导图2026-08-21），
 * 创建时弹出名称输入框，允许用户直接修改文件名；重名时自动追加序号。
 */
export async function createNewMindMap(
	app: App,
	language: Language,
	folderPath?: string,
): Promise<void> {
	const folder = folderPath || app.fileManager.getNewFileParent('').path;
	const defaultName = buildDefaultMindMapName(language);
	const name = await openNameInputModal(
		app,
		defaultName,
		folder,
		language,
	);
	if (name === null) {
		return; // 用户取消
	}
	try {
		const fileName = await ensureUniqueFileName(
			app,
			folder,
			withMdSuffix(name || defaultName),
		);
		const path = normalizePath(`${folder}/${fileName}`);
		// 新建内容为标准 Markdown 大纲；中心主题 = 文件名（虚拟文档根）
		const content = createDefaultMarkdownContent(language);
		const file = await app.vault.create(path, content);
		// 打开并自动切入导图视图（Obsidian 默认会以 markdown 打开 .md 文件）
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(file);
		await openAsMindMap(leaf, file);
		new Notice(t(language, 'command.created'));
	} catch (error) {
		new Notice(
			`${t(language, 'command.createFailed')}${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/** 同一目录下重名时自动追加序号（Obsidian 惯例：名称 1、名称 2...）。
 *  序号插在复合后缀 .mindmap.md 之前（stem 1.mindmap.md）。 */
async function ensureUniqueFileName(
	app: App,
	folder: string,
	fileName: string,
): Promise<string> {
	// 拆分 stem 与扩展：优先完整复合后缀
	const compound = fileName.match(/^(.*?)(\.mindmap\.md)$/i);
	const simple = !compound ? fileName.match(/^(.*?)(\.[^.]+)$/) : null;
	const stem = compound?.[1] ?? simple?.[1] ?? fileName;
	const extension = compound?.[2] ?? simple?.[2] ?? '';
	let candidate = fileName;
	let index = 1;
	// 性能：候选路径存在性检查代替全库路径 Set 构建（大库下每次创建 O(1)）
	while (
		app.vault.getAbstractFileByPath(normalizePath(`${folder}/${candidate}`))
	) {
		candidate = `${stem} ${index}${extension}`;
		index++;
	}
	return candidate;
}
