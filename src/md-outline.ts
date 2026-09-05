/**
 * Markdown 大纲解析：把 .mindmap.md 的正文解析为思维导图树。
 *
 * 渲染定位：本插件是 Markdown 的「渲染层」（纯 md 数据源，无专有中间格式）。
 * 本模块与 md-serialize.ts 互为逆映射（规范化保真）：
 *
 * 1) 结构：YAML frontmatter（原样保留）＋ ATX 标题（#~######）＋ 列表（缩进嵌套）
 *    ＋ 段落（合并为多行文本节点）。中心主题 = 虚拟文档根（文件名，第 0 层）；
 *    #~###### 严格对应第 1~6 级子主题；6 级标题之下用列表缩进表达第 7 级起
 *    （列表缩进降级法）；跳级标题按祖先链深度建层（mdLevel 保留原始 # 数）。
 * 2) 行内 wikilink（方案 A）：
 *    - 扫描行内全部 token：[[链接]] / [[链接|别名]] / [文本](url) / ![[图片]] / ![alt](url)；
 *    - data.text 为「剥壳显示文本」（无 [[]] 字面量残留）：链接 token 换成内部
 *      显示文本（别名优先，其次目标名），图片 token 不占文本（节点图即内容，
 *      多余图片剥壳为文本占位）；
 *    - 首个链接 token → hyperlink 字段（引擎单链：可点跳转），首个图片 → image；
 *    - 原文存 data.mdRaw、剥壳结果存 data.mdDerivedText：serialize 时若用户未
 *      编辑文本（text === mdDerivedText）整行逐字回写（mdRaw），编辑后走合成。
 * 3) 行内轻标记（** * ` ~~ HTML）不剥离，原样保留（无损往返）。
 */

import { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';

export interface MdParseResult {
	tree: MindMapTreeNode;
	/** 原样保留的 frontmatter 块（含首尾 ---），无则为 null */
	frontmatter: string | null;
}

const FM_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
/** 标题行：#~######（宽容：#标题 无空格亦可） */
const HEADING_RE = /^(#{1,6})(?:[ \t]+(.*))?$/;
/** 列表项：缩进 + 标记（- * + 或 数字.） + 内容 */
const LIST_RE = /^(\s*)([-*+]|\d+\.)[ \t]+(.*)$/;

interface ParsedLine {
	kind: 'heading' | 'list' | 'plain';
	indent: number;
	text: string;
	level?: number;
	marker?: string;
}

// ---------------------------------------------------------------------------
// 行内 token（wikilink / markdown 链接 / 图片）
// ---------------------------------------------------------------------------

type InlineTokenKind = 'wikiImg' | 'wiki' | 'mdImg' | 'mdLink';

interface InlineToken {
	start: number;
	end: number;
	kind: InlineTokenKind;
	/** 链接目标 / 图片地址（不含 [[ ]] 与 []() 包裹） */
	target: string;
	/** 别名 / alt / 链接文本（可空） */
	label: string;
}

const INLINE_RE =
	/(!?)\[\[([^\]|\n]+)(?:\|([^\]]*))?\]\]|(!?)\[([^\]]*)\]\(([^)\s\n]+)\)/g;

function tokenizeInline(raw: string): InlineToken[] {
	const out: InlineToken[] = [];
	INLINE_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = INLINE_RE.exec(raw))) {
		if (m[1] !== undefined) {
			// [[..]] 或 ![[..]]
			const target = m[2] ?? '';
			const label = (m[3] ?? '').trim();
			out.push({
				start: m.index,
				end: m.index + m[0].length,
				kind: m[1] === '!' ? 'wikiImg' : 'wiki',
				target,
				label,
			});
		} else {
			// [t](url) 或 ![alt](url)
			const label = (m[5] ?? '').trim();
			let target = m[6] ?? '';
			// 尖括号包裹的目标（CommonMark <url>，如 [t](<https://…>)）：
			// 剥壳存入，避免回写时对已含 <> 的目标二次包裹成 <<url>>。
			// 仅对 md 链接处理；图片目标保持原样（见 renderImage）。
			if (m[4] !== '!' && target.startsWith('<') && target.endsWith('>')) {
				target = target.slice(1, -1);
			}
			out.push({
				start: m.index,
				end: m.index + m[0].length,
				kind: m[4] === '!' ? 'mdImg' : 'mdLink',
				target,
				label,
			});
		}
	}
	return out;
}

/** token 的剥壳显示文本（节点文本中替换 [[]] 包裹后的样子） */
function tokenDisplay(tok: InlineToken): string {
	if (tok.label) {
		return tok.label;
	}
	const name = tok.target.split('/').pop() ?? tok.target;
	// wiki 链接目标：仅去 .md（笔记显示名，Obsidian 语义）；附件/其它保留扩展；
	// 图片保留文件名（含扩展）
	return tok.kind === 'wiki' ? name.replace(/\.md$/, '') : name;
}

/** buildInlineData 的稳定字段（text/mdRaw/mdDerivedText 恒为 string） */
interface InlineData extends Record<string, unknown> {
	text: string;
	mdRaw: string;
	mdDerivedText: string;
}

/**
 * 单行行内处理（方案 A）：
 * @returns data 含 text（剥壳显示文本）、mdRaw（原文）、mdDerivedText（=text，
 *   供 serialize 判断文本是否被用户编辑），以及首链接/首图字段。
 */
function buildInlineData(raw: string): InlineData {
	const data: InlineData = {
		text: '',
		mdRaw: raw,
		mdDerivedText: '',
	};
	const toks = tokenizeInline(raw);
	let firstLink = false;
	let firstImg = false;
	const pieces: string[] = [];
	let cursor = 0;
	for (const tok of toks) {
		pieces.push(raw.slice(cursor, tok.start));
		cursor = tok.end;
		if (tok.kind === 'wikiImg' || tok.kind === 'mdImg') {
			if (!firstImg) {
				firstImg = true;
				data.image = tok.target;
				data.mdImageTarget = tok.target;
				// 首图以节点图呈现，不占文本
			} else {
				pieces.push(tokenDisplay(tok));
			}
			continue;
		}
		if (tok.kind === 'wiki') {
			if (!firstLink) {
				firstLink = true;
				data.hyperlink = `[[${tok.target}${tok.label ? `|${tok.label}` : ''}]]`;
				data.mdLinkStyle = 'wiki';
				// 引擎链接图标原生 title（悬停提示目标名，提示可点）
				data.hyperlinkTitle = tokenDisplay(tok);
			}
		} else if (!firstLink) {
			firstLink = true;
			data.hyperlink = tok.target;
			data.mdLinkStyle = 'md';
			data.mdLinkText = tok.label || tok.target;
			data.hyperlinkTitle = tokenDisplay(tok);
		}
		pieces.push(tokenDisplay(tok));
	}
	pieces.push(raw.slice(cursor));
	let text = pieces.join('').trim();
	// 纯图节点：文本空时回退文件名（图仍在节点中显示，文本供搜索/悬浮）
	if (!text && data.image) {
		text = tokenDisplay(toks.find((t) => t.kind === 'wikiImg' || t.kind === 'mdImg')!);
	}
	data.text = text;
	data.mdDerivedText = text;
	return data;
}

// ---------------------------------------------------------------------------
// 正文解析
// ---------------------------------------------------------------------------

function splitFrontmatter(content: string): {
	body: string;
	frontmatter: string | null;
} {
	const m = content.match(FM_RE);
	if (!m) {
		return { body: content, frontmatter: null };
	}
	return { frontmatter: m[0], body: content.slice(m[0].length) };
}

/** 逐行分类（围栏整体原样保留；围栏外空行与分隔线忽略） */
function classifyLines(body: string): ParsedLine[] {
	const out: ParsedLine[] = [];
	const rawLines = body.split(/\r?\n/);
	/** 当前围栏（分隔符字符与长度）；null = 不在围栏内 */
	let fence: { char: string; length: number } | null = null;
	/** 上一条输出行是否属于围栏块（决定后续空行是否保留为分隔） */
	let lastLineIsFence = false;
	/** 围栏外暂存的连续空行：仅当与围栏相邻时才写入（保证围栏仍可识别） */
	let pendingBlank = 0;

	/**
	 * 围栏分隔行：≤3 空格缩进 + 3+ 个 ` 或 ~（后可接语言信息）。
	 * 返回分隔符；不匹配返回 null。
	 */
	const fenceMarker = (raw: string): { char: string; length: number } | null => {
		const m = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
		if (!m) {
			return null;
		}
		return { char: m[1]![0]!, length: m[1]!.length };
	};

	const pushRaw = (raw: string): void => {
		out.push({ kind: 'plain', indent: leadingSpaces(raw), text: raw });
	};

	for (let i = 0; i < rawLines.length; i++) {
		const rawLine = rawLines[i]!;

		// —— 围栏内：内容逐行原样保留（空行/缩进/类标题列表行都是代码内容）——
		if (fence) {
			pushRaw(rawLine);
			lastLineIsFence = true;
			// 闭合：同字符、长度 ≥ 起始，行尾无其他内容
			const close = fenceMarker(rawLine);
			if (
				close &&
				close.char === fence.char &&
				close.length >= fence.length &&
				/^[ \t]*$/.test(rawLine.slice(rawLine.indexOf(close.char) + close.length))
			) {
				fence = null;
			}
			continue;
		}

		if (!rawLine.trim()) {
			// 空行暂存：是围栏相邻分隔时才保留，段落间仍忽略（维持既有规范化）
			pendingBlank++;
			continue;
		}

		// —— 围栏开始（``` / ~~~ 行；含语言信息的 ```js 亦为开始）——
		const open = fenceMarker(rawLine);
		if (open) {
			// 围栏前空行属于围栏块：写入后围栏仍可被识别
			while (pendingBlank > 0) {
				pushRaw('');
				pendingBlank--;
			}
			fence = open;
			pushRaw(rawLine);
			lastLineIsFence = true;
			continue;
		}

		const line = rawLine.trimEnd();
		// 围栏闭合后的空行保留（避免围栏块与下文粘连成同一多行文本）
		if (lastLineIsFence && pendingBlank > 0) {
			while (pendingBlank > 0) {
				pushRaw('');
				pendingBlank--;
			}
		}
		lastLineIsFence = false;
		// 段落/标题/列表前的空行一律丢弃（维持既有规范化）——
		// 不能留到后续围栏处再 flush，否则空行会累积、每次往返多一行
		pendingBlank = 0;
		if (/^\s*---+\s*$/.test(line)) {
			continue;
		}
		const h = line.match(HEADING_RE);
		if (h) {
			const text = (h[2] ?? '').trim();
			if (text) {
				out.push({ kind: 'heading', indent: 0, text, level: h[1]!.length });
			}
			continue;
		}
		const l = line.match(LIST_RE);
		if (l) {
			const text = l[3]!.trim();
			if (text) {
				out.push({
					kind: 'list',
					indent: l[1]!.length,
					text,
					marker: /^\d+\.$/.test(l[2]!) ? 'ordered' : l[2],
				});
			}
			continue;
		}
		out.push({
			kind: 'plain',
			indent: leadingSpaces(line),
			text: line.trim(),
		});
	}
	return out;
}

function leadingSpaces(line: string): number {
	let n = 0;
	while (n < line.length && line[n] === ' ') {
		n++;
	}
	return n;
}

/**
 * 解析 md 正文为导图树。
 * @param content 完整文件内容（可含 frontmatter）
 * @param rootName 根（虚拟文档节点）名称，通常传文件 basename
 */
export function parseMdOutline(
	content: string,
	rootName: string,
): MdParseResult {
	const { body, frontmatter } = splitFrontmatter(content);
	const lines = classifyLines(body);

	// 虚拟文档根：text=文件名；回写时不输出该行
	const root: MindMapTreeNode = { data: { text: rootName }, children: [] };
	if (lines.length === 0) {
		return { frontmatter, tree: root };
	}

	/** heading 栈：[节点, # 数量]；虚拟根视作 level 0 恒在栈底 */
	const headingStack: { node: MindMapTreeNode; level: number }[] = [
		{ node: root, level: 0 },
	];
	/** 当前内容挂载点（= 栈顶 heading 节点） */
	let contentParent: MindMapTreeNode = root;
	/** list 缩进栈：仅跟踪同一内容区内的列表嵌套 */
	let listStack: { node: MindMapTreeNode; indent: number }[] = [];
	/** 等待合并的相邻 plain 文本行（存原始 trim 文本） */
	let plainBuffer: string[] = [];

	const flushPlain = (): void => {
		if (plainBuffer.length === 0) {
			return;
		}
		const raw = plainBuffer.join('\n');
		// 段落按行 token 化（保留行独立性），mdRaw 整块保留
		const derived: string[] = [];
		for (const lineRaw of plainBuffer) {
			const d = buildInlineData(lineRaw);
			derived.push(d.text);
		}
		const node: MindMapTreeNode = {
			data: {
				text: derived.join('\n'),
				mdRaw: raw,
				mdDerivedText: derived.join('\n'),
				mdType: 'plain',
			},
			children: [],
		};
		contentParent.children.push(node);
		plainBuffer = [];
	};

	const attachList = (rawText: string, marker: string, indent: number): void => {
		flushPlain();
		// 弹出缩进不小于当前的所有栈顶
		while (
			listStack.length > 0 &&
			listStack[listStack.length - 1]!.indent >= indent
		) {
			listStack.pop();
		}
		const parent =
			listStack.length > 0
				? listStack[listStack.length - 1]!.node
				: contentParent;
		const node: MindMapTreeNode = {
			data: {
				...buildInlineData(rawText),
				mdType: 'list',
				mdMarker: marker,
			},
			children: [],
		};
		parent.children.push(node);
		listStack.push({ node, indent });
	};

	for (const line of lines) {
		if (line.kind === 'heading') {
			flushPlain();
			listStack = [];
			const level = line.level ?? 1;
			while (
				headingStack.length > 1 &&
				headingStack[headingStack.length - 1]!.level >= level
			) {
				headingStack.pop();
			}
			const parent = headingStack[headingStack.length - 1]!.node;
			const node: MindMapTreeNode = {
				data: {
					...buildInlineData(line.text),
					mdType: 'heading',
					mdLevel: level,
				},
				children: [],
			};
			parent.children.push(node);
			headingStack.push({ node, level });
			contentParent = node;
			continue;
		}
		if (line.kind === 'plain') {
			// list 项的续行（缩进大于栈顶 list 且当前处于 list 区）→ 并入文本
			if (
				listStack.length > 0 &&
				line.indent > listStack[listStack.length - 1]!.indent
			) {
				const top = listStack[listStack.length - 1]!.node;
				const inline = buildInlineData(line.text);
				const prevText =
					typeof top.data.text === 'string' ? top.data.text : '';
				const prevDerived =
					typeof top.data.mdDerivedText === 'string'
						? top.data.mdDerivedText
						: '';
				const prevRaw =
					typeof top.data.mdRaw === 'string' ? top.data.mdRaw : '';
				top.data.text = `${prevText}\n${inline.text}`;
				top.data.mdDerivedText = `${prevDerived}\n${inline.text}`;
				top.data.mdRaw = `${prevRaw}\n${line.text}`;
				continue;
			}
			listStack = [];
			plainBuffer.push(line.text);
			continue;
		}
		// list 行
		attachList(line.text, line.marker ?? '-', line.indent);
	}
	flushPlain();
	return { frontmatter, tree: root };
}
