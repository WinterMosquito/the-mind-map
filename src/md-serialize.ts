/**
 * Markdown 序列化：把导图树（.mindmap.md 模式）还原为 md 正文。
 *
 * 与 md-outline.ts 互为逆映射（规范化保真，非逐字节）：
 * - 虚拟文档根（text=文件名）不输出任何行；
 * - 行级「未编辑检测」：节点含 mdRaw 且 data.text === data.mdDerivedText（且图片
 *   未被换）→ 整行逐字回写 mdRaw（保留全部 [[]] / ![] 包裹与格式）；用户编辑过
 *   文本或换过图 → 走合成：文本 + 行尾单链接 token（hyperlink）／图片 token；
 * - heading → `#×N 文本`；list → 缩进 + 标记 + 文本（ordered 重排编号 1..n）；
 *   plain → 原样多行文本；新用户节点（无 mdType/mdRaw）按 '-' 输出；
 * - 列表项多行文本（续行）非首行补 2 空格缩进，保证可再解析为续行。
 */

import { App } from 'obsidian';
import { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';
import { findAttachmentFile } from './images';

/** 是否为外部/协议 URL（http(s)://、obsidian://、ftp:// … 含 scheme://） */
function isDestUrl(link: string): boolean {
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(link);
}

/** 链接目标是否需要尖括号包裹（含空格/括号/<>/\，否则会破坏 `(…)` 闭合） */
function needsDestBraces(dest: string): boolean {
	return /[\s()<>\\]/.test(dest);
}

/** 行内 token 渲染：链接（仅合成路径使用） */
function renderHyperlink(data: Record<string, unknown>): string | null {
	const hyperlink = data.hyperlink;
	if (typeof hyperlink !== 'string' || !hyperlink) {
		return null;
	}
	// wiki 双链：原样保留
	if (hyperlink.startsWith('[[')) {
		return hyperlink;
	}
	const rawText = data.text;
	const text = typeof rawText === 'string' ? rawText : '';
	const rawLabel = data.mdLinkText;
	const label =
		typeof rawLabel === 'string' && rawLabel
			? rawLabel
			: text.split('\n')[0] || hyperlink;
	// URL / 协议链接 → 直接写为标准 autolink <url>（Obsidian 识别为可点链接，
	// 含空格/括号的 URL 也安全；无需 [label](<url>)）
	if (isDestUrl(hyperlink)) {
		return `<${hyperlink}>`;
	}
	if (data.mdLinkStyle === 'md') {
		// 非 URL 的 md 链接（如相对路径）：目标含空格/括号等时用尖括号包裹，
		// 避免破坏 `(…)` 闭合（Obsidian 亦识别 <dest>）
		const dest = needsDestBraces(hyperlink) ? `<${hyperlink}>` : hyperlink;
		return `[${label}](${dest})`;
	}
	// 其余（库内路径等非 URL）：裸目标 → 包一层 [[..]]（引擎语义一致）
	return `[[${hyperlink}]]`;
}

/** 行内 token 渲染：图片（仅合成路径使用） */
function renderImage(
	data: Record<string, unknown>,
	app: App | null,
): string | null {
	const image = data.image;
	if (typeof image !== 'string' || !image) {
		return null;
	}
	const target = data.mdImageTarget;
	if (typeof target === 'string' && image === target) {
		return `![[${target}]]`;
	}
	if (app) {
		const file = findAttachmentFile(app, image);
		if (file) {
			return `![[${file.path}]]`;
		}
	}
	if (/^(https?:|data:|blob:)/.test(image)) {
		return `![](${image})`;
	}
	return `![[${image}]]`;
}

/** 图片当前库内路径（view 把 image 解析为资源地址后反查）；无则原样 */
function imageVaultPath(
	data: Record<string, unknown>,
	app: App | null,
): string | null {
	const image = data.image;
	if (typeof image !== 'string' || !image) {
		return null;
	}
	if (app) {
		return findAttachmentFile(app, image)?.path ?? null;
	}
	return image;
}

/** 由 hyperlink 提取"目标特征串"（用于判断 mdRaw 中是否已含该链接） */
function hyperlinkFeature(hyperlink: string): string | null {
	if (!hyperlink) {
		return null;
	}
	if (hyperlink.startsWith('[[')) {
		// [[target|alias]] → 目标部分（不含别名）
		const inner = hyperlink.slice(2, -2);
		return inner.split('|')[0] ?? null;
	}
	return hyperlink; // http / obsidian:// / 库内路径
}

/** 链接的「可见文本」（Obsidian 语义：别名 → 去 .md 的目标名 / URL 原样） */
function nodeLinkDisplay(data: Record<string, unknown>): string | null {
	const hyperlink = data.hyperlink;
	if (typeof hyperlink !== 'string' || !hyperlink) {
		return null;
	}
	if (data.mdLinkStyle === 'md') {
		const rawLabel = data.mdLinkText;
		if (typeof rawLabel === 'string' && rawLabel) {
			return rawLabel;
		}
		return hyperlink;
	}
	if (hyperlink.startsWith('[[')) {
		const inner = hyperlink.slice(2, -2);
		const parts = inner.split('|');
		if (parts.length > 1 && parts[1]) {
			return parts[1]; // 别名
		}
		const name = (parts[0] ?? '').split('/').pop() ?? '';
		return name.replace(/\.md$/, '');
	}
	return hyperlink;
}

/** 图片的「文件名显示名」（parse 时纯图节点文本回退值） */
function imageSelfText(data: Record<string, unknown>): string | null {
	const target = data.mdImageTarget;
	if (typeof target !== 'string' || !target) {
		return null;
	}
	return target.split('/').pop() ?? null;
}

/**
 * 行级「未编辑检测」：mdRaw 有效（文本未变、图未换、链接未新增/更新）
 * 时逐字回写。
 * - 文本判定：data.text === data.mdDerivedText（用户双击编辑会改写 text）；
 * - 图片判定：当前图片的目标特征（反查库内路径，否则 image 原文）必须已出现
 *   在 mdRaw 中——view 加载把库内路径转 app:// 是可逆标准步（视为未变），
 *   而经「插入/更换图片」新增的引用不在 mdRaw 里 → 合成回写，避免旧 mdRaw
 *   覆盖导致新图引用丢失（mdImageTarget 可能被同步更新，不能作为比对基准）；
 * - 链接判定：hyperlink 的目标特征串必须出现在 mdRaw 中（通过「插入链接」
 *   新增/更新链接 → 合成回写，避免 mdRaw 原样覆盖导致链接丢失）。
 */
function rawOk(
	data: Record<string, unknown>,
	app: App | null,
): data is Record<string, unknown> & { mdRaw: string } {
	const raw = data.mdRaw;
	if (typeof raw !== 'string') {
		return false;
	}
	if (data.text !== data.mdDerivedText) {
		return false;
	}
	if (data.image !== undefined && data.image !== null && data.image !== '') {
		// 当前图片特征（库内路径或外链原文）须已存在于 mdRaw
		const rawImage = typeof data.image === 'string' ? data.image : null;
		const feature = imageVaultPath(data, app) ?? rawImage;
		if (feature && !raw.includes(feature)) {
			return false; // 图新增/更换，需合成
		}
	}
	if (typeof data.hyperlink === 'string' && data.hyperlink) {
		const feature = hyperlinkFeature(data.hyperlink);
		if (feature && !raw.includes(feature)) {
			return false; // 链接新增/更新，需合成
		}
	} else if (
		// 段落（plain）节点解析时本就不携带 hyperlink（多行文本无引擎单链），
		// 其 mdRaw 里的 [[..]]/[](url) 是原文的一部分——必须逐字回写；
		// 只有可携带链接的 heading/list 节点才可能是「用户清除了链接」。
		data.mdType !== 'plain' &&
		/\[\[|\[[^\]]*\]\(/.test(raw)
	) {
		// 链接已被清除（hyperlink 为空）但 mdRaw 仍含链接语法：
		// 需合成剥离为纯文本，否则旧 mdRaw 原样回写会让"清除链接"失效
		return false;
	}
	return true;
}

/** 合成路径：节点文本首行（剥壳文本 + 行尾链接/图片 token） */
function composeFirstLine(
	data: Record<string, unknown>,
	app: App | null,
): string {
	const text = typeof data.text === 'string' ? data.text.split('\n')[0] ?? '' : '';
	let line = text.trimEnd();
	const token = renderHyperlink(data) ?? renderImage(data, app);
	if (token) {
		line = line ? `${line} ${token}` : token;
	}
	return line;
}

/**
 * 序列化导图树为 md 正文（不含 frontmatter，调用方负责拼接）。
 * @param tree 虚拟文档根
 * @param app  可选：图片被编辑后反查库内路径时需要
 */
export function serializeMdBody(
	tree: MindMapTreeNode,
	app: App | null = null,
): string {
	const out: string[] = [];

	/** 输出一个"块"，heading/plain 前插入空行分隔（首行除外） */
	const pushBlock = (lines: string[]): void => {
		if (lines.length === 0) {
			return;
		}
		if (out.length > 0 && out[out.length - 1] !== '') {
			out.push('');
		}
		out.push(...lines);
	};

	/** 节点输出行（mdRaw 未变 → 原文；否则合成）。prefix=首行前缀，restIndent=续行缩进 */
	const nodeLines = (
		child: MindMapTreeNode,
		prefix: string,
		restIndent: string,
		app: App | null,
	): string[] => {
		const data: Record<string, unknown> = child.data ?? {};
		if (rawOk(data, app)) {
			const rawLines = data.mdRaw.split('\n');
			return [
				prefix + rawLines[0]!,
				...rawLines.slice(1).map((l) => restIndent + l),
			];
		}
		const text = typeof data.text === 'string' ? data.text : '';
		const lines = text.split('\n');
		// 纯 token 节点（文本恰为链接/图片自身显示名，来自解析的单链/单图行，
		// 或「插入链接」已同步文本）→ 换图/换链后只输出新 token，避免旧名冗余。
		if (
			lines.length === 1 &&
			text.trim() !== '' &&
			(nodeLinkDisplay(data) === text.trim() ||
				imageSelfText(data) === text.trim())
		) {
			const token = renderHyperlink(data) ?? renderImage(data, app) ?? '';
			if (token) {
				return [prefix + token];
			}
		}
		return [
			prefix + composeFirstLine(data, app),
			...lines.slice(1).map((l) => restIndent + l),
		];
	};

	interface SerializeFrame {
		children: MindMapTreeNode[];
		index: number;
		listIndent: number;
		orderedCount: number;
	}

	/**
	 * 显式栈替代递归：树深度由内容（缩进可任意深、可作者构造）决定，
	 * 递归实现在超深层级上会触发 RangeError 栈溢出导致保存崩溃。
	 * 语义与递归等价：先序输出，orderedCount/缩进按层独立。
	 */
	const walkChildren = (parent: MindMapTreeNode, listIndent: number): void => {
		const stack: SerializeFrame[] = [
			{
				children: parent.children ?? [],
				index: 0,
				listIndent,
				orderedCount: 0,
			},
		];
		while (stack.length > 0) {
			const frame = stack[stack.length - 1]!;
			if (frame.index >= frame.children.length) {
				stack.pop();
				continue;
			}
			const child = frame.children[frame.index]!;
			frame.index++;
			const data: Record<string, unknown> = child.data ?? {};
			const type = data.mdType as string | undefined;
			if (type === 'heading') {
				frame.orderedCount = 0;
				const level = Math.min(6, Math.max(1, Number(data.mdLevel) || 1));
				pushBlock(nodeLines(child, '#'.repeat(level) + ' ', '', app));
				stack.push({
					children: child.children ?? [],
					index: 0,
					listIndent: 0,
					orderedCount: 0,
				});
				continue;
			}
			if (type === 'plain') {
				frame.orderedCount = 0;
				if (rawOk(data, app)) {
					pushBlock(data.mdRaw.split('\n'));
				} else {
					pushBlock(
						(typeof data.text === 'string' ? data.text : '').split('\n'),
					);
				}
				stack.push({
					children: child.children ?? [],
					index: 0,
					listIndent: frame.listIndent,
					orderedCount: 0,
				});
				continue;
			}
			// list 或未标注（新建）节点 → 列表行
			const marker =
				data.mdMarker === 'ordered'
					? `${frame.orderedCount + 1}.`
					: (data.mdMarker as string) || '-';
			frame.orderedCount =
				data.mdMarker === 'ordered' ? frame.orderedCount + 1 : 0;
			const indent = '  '.repeat(frame.listIndent);
			out.push(...nodeLines(child, indent + marker + ' ', indent + '  ', app));
			stack.push({
				children: child.children ?? [],
				index: 0,
				listIndent: frame.listIndent + 1,
				orderedCount: 0,
			});
		}
	};

	walkChildren(tree, 0);
	return out.join('\n');
}
