/**
 * .mindmap.md 文档模式：触发判定与视图切换。
 *
 * 渲染承载（B3 显式切换）：.mindmap.md 仍是普通 Markdown（默认用 Obsidian
 * markdown 视图打开）；用户通过命令/文件右键「以思维导图打开」显式把当前
 * leaf 切到本插件的导图视图（编辑与阅读模式下入口均可用），并可随时切回。
 */
import { MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE } from './constants';

/** 触发判定：md 文件且路径以 .mindmap.md 结尾（大小写不敏感） */
const MD_MARKER_RE = /\.mindmap\.md$/i;

/**
 * 「以思维导图打开」偏好写入钩子（由插件注册，经 view-state 记录
 * openAs=mindmap —— 双向偏好：最后一次主动选择决定下次打开方式）。
 */
let openAsPreferenceHook: ((path: string) => void) | null = null;

export function setOpenAsPreferenceHook(
	hook: ((path: string) => void) | null,
): void {
	openAsPreferenceHook = hook;
}

export function isMindMapMarkdownFile(
	file: TFile | null | undefined,
): boolean {
	return (
		!!file &&
		file.extension === 'md' &&
		MD_MARKER_RE.test(file.path)
	);
}

/**
 * 把当前 leaf 切换到导图视图（记录进入前的编辑/阅读模式，供返回）。
 */
export async function openAsMindMap(
	leaf: WorkspaceLeaf,
	file: TFile,
): Promise<void> {
	const mode: 'source' | 'preview' =
		leaf.view instanceof MarkdownView ? leaf.view.getMode() : 'source';
	openAsPreferenceHook?.(file.path);
	await leaf.setViewState({
		type: VIEW_TYPE,
		state: { file: file.path, mdBackMode: mode },
	});
}

/** 从导图视图切回 Markdown（mode: source 编辑 / preview 阅读） */
export async function openAsMarkdown(
	leaf: WorkspaceLeaf,
	file: TFile,
	mode: 'source' | 'preview' = 'source',
): Promise<void> {
	await leaf.setViewState({
		type: 'markdown',
		state: { file: file.path, mode },
	});
}
