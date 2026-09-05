/**
 * Markdown ↔ 思维导图 往返回归测试（.mindmap.md 渲染层）。
 *
 * 覆盖（对应 docs/markdown-mindmap-standard.md）：
 * - 解析结构：标题/列表/段落/围栏/frontmatter 的树映射
 * - 层级深度：标题跳级、6 级标题下列表降级、深层列表
 * - 往返不动点：parse → serialize → parse → serialize 输出稳定，
 *   未编辑行（含 [[]]/![]/代码围栏）逐字保留
 * - 编辑合成：用户改文本/换图后按节点合成新行、未触碰行保持原文
 * - 健壮性回归：深树无栈溢出（显式栈）、代码围栏不被解析成标题/列表
 *
 * 运行：node scratch/md-roundtrip/build-test.mjs（自动 bundle + 执行）
 */
import { parseMdOutline } from '../../src/md-outline';
import { serializeMdBody } from '../../src/md-serialize';
import { ensureUniqueUids } from '../../src/markdown';

type MNode = { data?: Record<string, unknown>; children?: MNode[] };

// ---------------------------------------------------------------------------
// 断言与计数
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
	if (cond) {
		passed++;
	} else {
		failed++;
		failures.push(msg);
		console.error('FAIL - ' + msg);
	}
}

function eq(actual: unknown, expected: unknown, msg: string): void {
	if (actual === expected) {
		passed++;
	} else {
		failed++;
		failures.push(msg);
		console.error(`FAIL - ${msg}\n   expected: ${JSON.stringify(expected)}\n   actual  : ${JSON.stringify(actual)}`);
	}
}

/** 所有节点（含虚拟根）的 {data, depth} 先序列表 */
function collect(root: MNode): { node: MNode; depth: number }[] {
	const out: { node: MNode; depth: number }[] = [];
	const walk = (n: MNode, d: number): void => {
		out.push({ node: n, depth: d });
		for (const c of n.children ?? []) walk(c, d + 1);
	};
	walk(root, 0);
	return out;
}

function textsOf(n: MNode): string[] {
	return collect(n).map(({ node }) =>
		typeof node.data?.text === 'string' ? node.data.text : '',
	);
}

function hasNode(n: MNode, pred: (data: Record<string, unknown>) => boolean): boolean {
	return collect(n).some(({ node }) => pred(node.data ?? {}));
}

const roundTrip = (md: string): { mdRaw: string; md2: string } => {
	const first = parseMdOutline(md, '测试');
	const out1 = serializeMdBody(first.tree, null);
	const second = parseMdOutline(out1, '测试');
	const out2 = serializeMdBody(second.tree, null);
	return { mdRaw: out1, md2: out2 };
};

// ---------------------------------------------------------------------------
// 一、解析结构
// ---------------------------------------------------------------------------
{
	const md = ['# 一级', '## 二级', '### 三级', '', '- a', '  - a1', '', '正文段落。', '', '```', '# 代码里的标题', '- 代码里的列表', '```'].join('\n');
	const r = parseMdOutline(md, '根');
	eq(r.frontmatter, null, '无 frontmatter');
	const list = collect(r.tree);
	eq(list[0]!.node.data?.text, '根', '虚拟根文本 = 文件名');
	// 标题链：根 → 一级 → 二级 → 三级
	const h1 = r.tree.children![0]!;
	eq(h1.data?.mdType, 'heading', '第一个节点为 heading');
	eq(h1.data?.mdLevel, 1, '# → level 1');
	eq(h1.children![0]!.data?.mdLevel, 2, '## → level 2');
	eq(h1.children![0]!.children![0]!.data?.mdLevel, 3, '### → level 3');
	// 三级下的列表
	const h3 = h1.children![0]!.children![0]!;
	assert(h3.children!.length >= 1, '三级标题下有内容');
	const li = h3.children![0]!;
	eq(li.data?.mdType, 'list', '列表项 mdType=list');
	eq(li.data?.mdMarker, '-', '无序标记 -');
	eq(li.children![0]!.data?.text, 'a1', '嵌套子列表 a1');
	// 段落
	const plainNodes = collect(r.tree).filter(({ node }) => node.data?.mdType === 'plain');
	assert(plainNodes.length >= 1, '存在 plain 段落节点');
	assert(textsOf(r.tree).some((t) => t.includes('正文段落')), '段落文本在树中');
	// 围栏：内部 #/- 不得成为 heading/list 节点
	assert(
		!hasNode(r.tree, (d) => d.mdType === 'heading' && d.text === '# 代码里的标题'),
		'围栏内 # 行不是 heading 节点',
	);
	assert(
		!hasNode(r.tree, (d) => d.mdType === 'list' && d.text === '- 代码里的列表'),
		'围栏内 - 行不是 list 节点',
	);
}

// 多根拍平：两个同级 # 都在虚拟根下
{
	const r = parseMdOutline('# A\n\n# B\n', '根');
	eq(r.tree.children!.length, 2, '两个一级标题同挂虚拟根');
	eq(r.tree.children![1]!.data?.text, 'B', '第二个根为 B');
}

// 跳级：'#' 后直接 '###' → 挂在祖先链上（无空层），mdLevel 保留 3
{
	const r = parseMdOutline('# X\n\n### Y\n', '根');
	const x = r.tree.children![0]!;
	assert(x.children!.length === 1 && x.children![0]!.data?.text === 'Y', '跳级标题挂到 X 下');
	eq(x.children![0]!.data?.mdLevel, 3, '跳级保留原始 # 数量 3');
}

// frontmatter：原样切出，不进入导图树
{
	const fm = '---\ntitle: 测试\ntags: [a, b]\n---\n\n# 正文\n';
	const r = parseMdOutline(fm, '根');
	eq(r.frontmatter, '---\ntitle: 测试\ntags: [a, b]\n---\n', 'frontmatter 原样保留');
	eq(r.tree.children!.length, 1, 'frontmatter 不产生节点');
	eq(r.tree.children![0]!.data?.text, '正文', '正文标题进入树');
}

// 分隔线与空行忽略；纯列表文档（无标题）直接挂在虚拟根
{
	const r = parseMdOutline('- 一\n\n---\n\n- 二\n', '根');
	eq(r.tree.children!.length, 2, '空行/--- 不产生节点');
	eq(r.tree.children![0]!.data?.text, '一', '纯列表：根 → 一');
}

// 行内 [[]] / ![] / **bold** 在标题/列表节点保留原文（mdRaw）
{
	const md = ['# [[笔记|别名]] 与 **粗体**', '', '- ![[图.png]]', '- 普通 [链接](https://example.com)'].join('\n');
	const r = parseMdOutline(md, '根');
	const { mdRaw } = roundTrip(md);
	assert(mdRaw.includes('# [[笔记|别名]] 与 **粗体**'), '标题 [[..|别名]] 往返保留');
	assert(mdRaw.includes('- ![[图.png]]'), '列表 ![[图]] 往返保留');
	assert(mdRaw.includes('[链接](https://example.com)'), '列表 md 链接往返保留');
	assert(!mdRaw.includes('[[') || hasNode(r.tree, (d) => typeof d.hyperlink === 'string'), 'wikilink 有 hyperlink 承载');
}

// URL 链接：解析 [t](<url>) 剥壳；未编辑回写保留原样
{
	const md = ['- [文本](<https://example.com>)'].join('\n');
	const r = parseMdOutline(md, '根');
	const li = r.tree.children![0]!;
	eq(li.data?.hyperlink, 'https://example.com', '解析时剥去 [..](<url>) 的外层尖括号');
	eq(li.data?.mdLinkStyle, 'md', 'md 链接样式');
	eq(li.data?.text, '文本', '可见文本为标签');
	const out = serializeMdBody(r.tree, null);
	assert(out.includes('[文本](<https://example.com>)'), '未编辑的 md 链接按原文回写');
	const out2 = serializeMdBody(parseMdOutline(out, '根').tree, null);
	eq(out2, out, 'md 链接往返不动点（无双层尖括号）');
}

// 裸 autolink <url>：解析为链接；未编辑回写 <url>；往返不动点
{
	const md = ['- <https://example.com>'].join('\n');
	const r = parseMdOutline(md, '根');
	eq(r.tree.children![0]!.data?.hyperlink, 'https://example.com', '解析 <url> 自动链接为超链接');
	eq(r.tree.children![0]!.data?.text, 'https://example.com', '自动链接节点文本 = URL');
	const out = serializeMdBody(r.tree, null);
	assert(out.includes('<https://example.com>'), 'autolink 回写为 <url>');
	const out2 = serializeMdBody(parseMdOutline(out, '根').tree, null);
	eq(out2, out, 'autolink 往返不动点');
}

// 插入 URL 链接（引擎节点，无 mdRaw）：回写为 <url>
{
	const tree = parseMdOutline('# R\n', '根').tree;
	tree.children![0]!.children!.push({
		data: { text: 'https://example.com', hyperlink: 'https://example.com' },
	});
	const out = serializeMdBody(tree, null);
	assert(out.includes('- <https://example.com>'), '新插入的 URL 回写为 <url>');
	assert(!out.includes('<<'), '无双层尖括号');
}

// 非 URL 的 md 链接（相对路径）不加尖括号
{
	const md = ['- [笔记](folder/note.md)'].join('\n');
	const r = parseMdOutline(md, '根');
	eq(r.tree.children![0]!.data?.hyperlink, 'folder/note.md', '相对路径非 URL');
	const out = serializeMdBody(r.tree, null);
	assert(out.includes('[笔记](folder/note.md)'), '非 URL 的 md 链接不加尖括号');
}

// 段落（plain）行内 [[..]] / [](url) / 轻标记：未编辑整段逐字回写
{
	const md = ['# H', '', '参见 [[设计稿|设计]] 与 [仓库](https://example.com) 说明', '', '另段含 **粗体** 与 [[普通链接]]。'].join('\n');
	const { mdRaw } = roundTrip(md);
	assert(
		mdRaw.includes('参见 [[设计稿|设计]] 与 [仓库](https://example.com) 说明'),
		'段落内 [[]] 与 [](url) 未编辑逐字回写',
	);
	assert(mdRaw.includes('另段含 **粗体** 与 [[普通链接]]。'), '段落轻标记与双链逐字回写');
}

// ---------------------------------------------------------------------------
// 二、层级深度
// ---------------------------------------------------------------------------
{
	// 6 级标题逐级加深
	const md = ['# h1', '## h2', '### h3', '#### h4', '##### h5', '###### h6'].join('\n');
	const r = parseMdOutline(md, '根');
	const levels: (number | undefined)[] = [];
	const walk = (n: MNode, depth: number): void => {
		if (depth > 0) levels.push(n.data?.mdLevel as number | undefined);
		for (const c of n.children ?? []) walk(c, depth + 1);
	};
	walk(r.tree, 0);
	eq(levels.join(','), '1,2,3,4,5,6', '标题 1–6 级链');

	// 6 级标题下用列表缩进表达第 7 级（列表缩进降级法）
	const deep = parseMdOutline(['###### base', '', '  - level7'].join('\n'), '根');
	const base = deep.tree.children![0]!;
	assert(base.children!.length === 1, '###### 下挂列表');
	eq(base.children![0]!.data?.text, 'level7', '第 7 级文本正确');
}

// 深层列表（50 级）解析深度与序列化不溢出
{
	const depth = 50;
	const lines = ['# 深', ''];
	for (let i = 0; i < depth; i++) lines.push('  '.repeat(i) + '- l' + i);
	const r = parseMdOutline(lines.join('\n'), '根');
	const maxDepth = Math.max(...collect(r.tree).map((e) => e.depth));
	assert(maxDepth >= depth + 1, `深层列表深度保留（max=${maxDepth}）`);
	const out = serializeMdBody(r.tree, null);
	assert(out.includes('- l' + (depth - 1)), '深层列表可序列化');
}

// 超深树（5 万级）序列化/uid 修复不栈溢出 —— 显式栈回归
{
	const depth = 50000;
	let chain: MNode = { data: { text: 'deep0' } };
	let cursor = chain;
	for (let i = 1; i < depth; i++) {
		const next: MNode = { data: { text: 'deep' + i, mdType: 'heading', mdLevel: 1 } };
		cursor.children = [next];
		cursor = next;
	}
	let ok = false;
	try {
		ensureUniqueUids(chain as never);
		const out = serializeMdBody(chain as never, null);
		ok = out.length > 0;
	} catch {
		ok = false;
	}
	assert(ok, '5 万级深树：uid 修复 + 序列化无栈溢出');
}

// ---------------------------------------------------------------------------
// 三、往返不动点
// ---------------------------------------------------------------------------
{
	// 综合文档：标题 + 嵌套列表 + 段落 + 围栏（含 # / - / 空行）+ 有序列表
	const md = [
		'# 主题',
		'',
		'- 项 A',
		'  - 子项 1',
		'  - 子项 2',
		'- 项 B',
		'',
		'正文段落，含 **强调** 与 [[维基链接]]。',
		'',
		'```ts',
		'# 注释行-不是列表',
		'- 不是列表项',
		'',
		'const x = 1; // code',
		'```',
		'',
		'1. 序一',
		'2. 序二',
	].join('\n');
	const { mdRaw, md2 } = roundTrip(md);
	eq(md2, mdRaw, '综合文档：二次往返不动点');
	assert(mdRaw.includes('```ts'), '围栏起始保留');
	assert(mdRaw.includes('const x = 1; // code'), '围栏代码行保留');
	assert(mdRaw.includes('# 主题'), '标题保留');
	assert(mdRaw.includes('- 子项 2'), '嵌套列表保留');
	assert(mdRaw.includes('1. 序一') && mdRaw.includes('2. 序二'), '有序列表重排稳定');
}

// 围栏往返不动点（围栏前空行不漂移：修旧有「每趟多一行」缺陷）
{
	const md = ['# 顶', '', '前文。', '', '```', 'code', '```', '', '- 后置'].join('\n');
	const { mdRaw, md2 } = roundTrip(md);
	eq(md2, mdRaw, '围栏相邻空行：往返不动点');
	const blankCount = mdRaw.split('\n').filter((l) => l === '').length;
	assert(blankCount >= 2 && blankCount <= 4, `空行数量稳定（${blankCount}）`);
}

// 未编辑行（含 [[..]] / ![] / 行内强调）逐字回写
{
	const md = ['# H', '', '- [[目标|显示名]]', '- ![[img.png]]', '- **加粗**项'].join('\n');
	const { mdRaw } = roundTrip(md);
	assert(mdRaw.includes('- [[目标|显示名]]'), 'wikilink 行逐字回写');
	assert(mdRaw.includes('- ![[img.png]]'), '图片行逐字回写');
	assert(mdRaw.includes('- **加粗**项'), '轻标记行逐字回写');
}

// ---------------------------------------------------------------------------
// 四、编辑合成
// ---------------------------------------------------------------------------
{
	// 编辑列表项文本 → 该行合成，未编辑行保持原文
	const md = ['# R', '', '- 原样一', '- 修改我'].join('\n');
	const tree = parseMdOutline(md, '根').tree;
	const target = tree.children![0]!.children!.find((c) => c.data?.text === '修改我')!;
	target.data!.text = '改成了';
	const out = serializeMdBody(tree, null);
	assert(out.includes('- 原样一'), '未编辑项原样保留');
	assert(out.includes('- 改成了'), '编辑项合成新文本');
	assert(!out.includes('修改我'), '旧文本被替换');
}

{
	// 编辑标题文本 → '# 新标题'
	const tree = parseMdOutline('# 旧标题\n', '根').tree;
	tree.children![0]!.data!.text = '新标题';
	const out = serializeMdBody(tree, null);
	assert(out.includes('# 新标题'), '编辑后的标题行合成');
}

{
	// 新建节点（无 mdType / mdRaw）→ '- 文本'
	const tree = parseMdOutline('# R\n', '根').tree;
	tree.children![0]!.children!.push({ data: { text: '新节点' } });
	const out = serializeMdBody(tree, null);
	assert(out.includes('- 新节点'), '新建节点按列表行输出');
}

{
	// 换图：mdImageTarget 旧 → 外部 URL，合成 ![](...)
	const tree = parseMdOutline('- ![[old.png]]\n', '根').tree;
	const node = tree.children![0]!;
	node.data!.image = 'https://example.com/new.png';
	const out = serializeMdBody(tree, null);
	assert(out.includes('![](https://example.com/new.png)'), '换图后合成为外链图片');
	assert(!out.includes('old.png'), '旧图引用不残留');
}

{
	// 深层列表里编辑叶子 → 全链输出且不溢出
	const depth = 40;
	const lines = ['# 深', ''];
	for (let i = 0; i < depth; i++) lines.push('  '.repeat(i) + '- l' + i);
	const tree = parseMdOutline(lines.join('\n'), '根').tree;
	let leaf: MNode | undefined;
	const findLeaf = (n: MNode): MNode | undefined =>
		n.children?.length ? findLeaf(n.children[n.children.length - 1]!) : n;
	leaf = findLeaf(tree);
	leaf!.data!.text = '已编辑';
	const out = serializeMdBody(tree, null);
	assert(out.includes('- 已编辑'), '深层叶子编辑可合成');
}

// ---------------------------------------------------------------------------
// 五、uid 修复（ensureUniqueUids）
// ---------------------------------------------------------------------------
{
	const dup: MNode = {
		data: { text: 'a', uid: 'x' },
		children: [{ data: { text: 'b', uid: 'x' } }, { data: { text: 'c' } }],
	};
	const changed = ensureUniqueUids(dup as never);
	assert(changed, '检测到重复/缺失 uid 并修复');
	const seen = new Set<string>();
	const walk = (n: MNode): void => {
		if (typeof n.data?.uid === 'string') seen.add(n.data.uid as string);
		for (const c of n.children ?? []) walk(c);
	};
	walk(dup);
	eq(seen.size, 3, '全部节点 uid 唯一');
}

// ---------------------------------------------------------------------------
console.log(`\n通过 ${passed} 项断言${failed ? `，失败 ${failed} 项` : ''}`);
if (failed > 0) {
	console.error('失败项：\n' + failures.map((f) => ' - ' + f).join('\n'));
	process.exit(1);
}
