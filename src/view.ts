/**
 * 思维导图视图核心：生命周期（打开/关闭/加载文件）、引擎实例管理、
 * 自动保存、链接跳转、引用更新。
 * 功能模块（从本文件拆出）：
 * - view-toolbar.ts      工具栏
 * - view-dnd.ts          拖拽/外部文件导入/附件悬浮
 * - view-context-menu.ts 右键菜单
 * - view-node-actions.ts 节点操作与附件
 * - view-paste.ts        粘贴处理
 * - view-status.ts       状态栏
 * - view-search.ts       搜索栏
 * - view-export.ts       导入导出
 */
import {
	FileView,
	Notice,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';
import TheMindMapPlugin from './main';
import { Language, t } from './i18n';
import { canOpenInObsidian, isSystemMediaExtension, VIEW_TYPE } from './constants';
import {
	MindMap,
	MindMapNode,
	MindMapNodeData,
	MindMapTreeNode,
} from '../vendor/simple-mind-map.cjs';
import {
	createMindMap,
	destroyMindMap,
	fitMindMap,
	getThemeConfig,
	isDarkTheme,
} from './mindmap';
import {
	removeReferencesOnDelete,
	resolvePathToFile,
	updateReferencesOnRename,
} from './links';
import { ensureUniqueUids } from './markdown';
import {
	normalizeImageSizes,
	sanitizeFileName,
	walkCorrectImageSizesByAspect,
	walkResolveImagePaths,
} from './images';
import { parseMdOutline } from './md-outline';
import { serializeMdBody } from './md-serialize';
import { isMindMapMarkdownFile, openAsMarkdown } from './md-open';
import { registerWikilinkInteractions } from './view-wikilink';
import {
	buildSearchBar,
	closeSearchBar,
	doSearch,
	openSearchBar,
	searchNext,
	searchPrev,
	updateSearchCount,
} from './view-search';
import { EventBinder } from './event-binder';
import { exportPNG } from './view-export';
import { arrangeMindMap, buildToolbar, refreshToolbar } from './view-toolbar';
import { setupDragAndDrop } from './view-dnd';
import { setupContextMenu } from './view-context-menu';
import { openFileWithSystemApp } from './view-attachments';
import { handleWindowPaste, setupPasteHandler } from './view-paste';
import { updateStatusBar } from './view-status';
import { openNodeImageFullscreen } from './view-image-fullscreen';

const SAVE_DELAY_MS = 800;

export class MindMapView extends FileView {
	plugin: TheMindMapPlugin;
	mindMap: MindMap | null = null;
	canvasEl: HTMLElement | null = null;
	toolbarEl: HTMLElement | null = null;
	searchBarEl: HTMLElement | null = null;
	searchInput: HTMLInputElement | null = null;
	searchCountEl: HTMLElement | null = null;
	layoutSelect: HTMLSelectElement | null = null;
	saveTimeout: number | null = null;
	isDark = false;
	ready = false;
	clipboardNode: MindMapNodeData | null = null;

	/**
	 * 引擎实例作用域的事件绑定器：
	 * 每次 initMindMap 时随新引擎实例注册的 DOM/引擎事件都挂在这里，
	 * destroyMindMapInstance() 调用 destroy() 一次性清理（替代原 boundHandle* 字段）。
	 * 跨文件（view-dnd / view-context-menu / view-paste）共享，故公开。
	 */
	engineEvents = new EventBinder();
	/**
	 * 视图生命周期作用域的事件绑定器：
	 * onOpen 时注册的搜索输入框等事件挂在这里，onClose 时清理。
	 * 跨文件（view-search）共享，故公开。
	 */
	viewEvents = new EventBinder();
	/** 上次节点拖拽结束时间（拖拽落点在图片上时浏览器仍会触发 click，用于忽略） */
	private lastNodeDragEndAt = 0;
	/** 附件悬浮预览防抖（view-dnd.ts 读写） */
	lastHoverPreviewEl: Element | null = null;
	lastHoverPreviewAt = 0;
	/** 状态栏节流（view-status.ts 读写，onClose 清理） */
	lastStatusBarUpdate = 0;
	statusBarTrailingTimer: number | null = null;
	private boundHandleCssChange: (() => void) | null = null;
	private saveInProgress = false;
	private savePending = false;
	/** 待写快照：视图卸载时引擎已销毁，用它兜底最后一批编辑 */
	private pendingTree: MindMapTreeNode | null = null;
	/** 串行写盘链：所有 save 调用共享，调用方可 await 完整排空 */
	private saveChain: Promise<void> = Promise.resolve();
	/**
	 * 文件加载去重：onOpen 与 onLoadFile 都会为同一文件触发加载
	 * （Obsidian 对 FileView 的调用时序不保证），记录进行中的加载路径，
	 * 避免同一文件被重复读取、重复创建引擎实例。
	 */
	private loadingFilePath: string | null = null;
	/**
	 * 引擎初始化代际锁：每次新的 initMindMap 请求或视图卸载都会递增，
	 * 使之前零尺寸定时重试作废——重试只允许在「仍是最近一次请求」
	 * 且视图仍挂载时执行，避免文件切换/视图关闭后过期 tree 被渲染，
	 * 进而把旧文件内容写进新文件。
	 */
	private initSeq = 0;
	/**
	 * 当前布局（持久化到文件的唯一来源；不依赖 getData() 返回活引用还是深拷贝）。
	 * 由 view-toolbar.ts 写入、本类 initMindMap/save 读写。
	 */
	currentLayout: string | null = null;

	/**
	 * .mindmap.md 文档模式（B3 显式切换）：文件本质是 Markdown，用导图视图
	 * 编辑并回写为 md 大纲。
	 */
	/** 进入前 markdown 视图模式（返回「以 Markdown 编辑」时恢复） */
	mdBackMode: 'source' | 'preview' = 'source';
	/** 原样保留的 frontmatter 块（保存时拼回文件头） */
	mdFrontmatter: string | null = null;
	/**
	 * 文档模式标记：parseDocument 时按文件名锁定（保存/回写恒为 md 大纲；
	 * 标记用于工具栏返回按钮与相关交互的显示判定）。
	 */
	mdDocumentMode = false;

	/** 当前文件是否为 .mindmap.md 文档模式（由 parseDocument 锁定） */
	isMdDocument(): boolean {
		return this.mdDocumentMode;
	}

	constructor(leaf: WorkspaceLeaf, plugin: TheMindMapPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.isDark = document.body.hasClass('theme-dark');
	}

	/** 当前界面语言 */
	get lang(): Language {
		return this.plugin.settings.language;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		// 中心主题 ⇄ 文件名同步（改中心即重命名）；标题显示即文件名
		return this.file ? this.file.basename : t(this.lang, 'common.mindMap');
	}

	getIcon(): string {
		return 'dot-network';
	}

	async onOpen(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('mindmap-view-container');
		this.toolbarEl = containerEl.createDiv('mindmap-toolbar');
		buildToolbar(this);
		this.searchBarEl = containerEl.createDiv('mindmap-search-bar');
		this.buildSearchBar();
		this.canvasEl = containerEl.createDiv('mindmap-canvas-container');

		this.boundHandleCssChange = () => {
			const dark = document.body.hasClass('theme-dark');
			if (dark !== this.isDark) {
				this.isDark = dark;
				this.applyTheme();
			}
		};
		this.registerEvent(
			this.app.workspace.on('css-change', this.boundHandleCssChange),
		);
		this.scope?.register(['Mod'], 'f', () => {
			this.openSearchBar();
			return false;
		});

		// 窗口级粘贴兜底：只注册一次（随视图生命周期由 Component 自动清理），
		// 不放在 setupPasteHandler 中，避免每次刷新引擎累积监听。
		this.registerDomEvent(window, 'paste', (event) => {
			handleWindowPaste(this, event);
		});

		this.ready = true;
		if (this.file) {
			await this.loadMindMapFromFile(this.file);
		}
	}

	async onLoadFile(file: TFile): Promise<void> {
		if (!this.ready) {
			await this.waitForReady();
		}
		// onOpen 已为同一文件启动加载（读取中或已完成）时跳过，
		// 避免同一文件被读取两次、引擎实例被创建两次。
		if (this.loadingFilePath === file.path) {
			return;
		}
		await this.loadMindMapFromFile(file);
	}

	async onUnloadFile(): Promise<void> {
		// 文件切换：作废本文件尚未执行的初始化重试，防止过期 tree 随后渲染
		this.initSeq++;
		if (this.saveTimeout) {
			window.clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
		if (this.titleRenameTimer !== null) {
			window.clearTimeout(this.titleRenameTimer);
			this.titleRenameTimer = null;
		}
		// 先保存当前视口，再写盘正文（引擎随后销毁）
		this.persistViewport();
		await this.save();
		// 文件切换后允许再次加载同一路径（新会话）
		this.loadingFilePath = null;
		this.destroyMindMapInstance();
	}

	private waitForReady(): Promise<void> {
		return new Promise((resolve) => {
			const check = (): void => {
				if (this.ready) {
					resolve();
				} else {
					window.setTimeout(check, 10);
				}
			};
			check();
		});
	}

	private async loadMindMapFromFile(file: TFile): Promise<void> {
		this.loadingFilePath = file.path;
		// 布局取自视图状态存储（按文件路径）；不再跨文件沿用上一文件的布局
		this.currentLayout =
			this.plugin.viewState.getLayout(file.path) ??
			this.plugin.settings.defaultLayout;
		try {
			const content = await this.app.vault.read(file);
			// 加载期间文件已切换：丢弃过期结果
			if (this.loadingFilePath !== file.path) {
				return;
			}
			const tree = this.parseDocument(content, file);
			// 按图片原始宽高比校正尺寸（统一高度、宽度按比例），
			// 在首次渲染前完成，避免首帧用固定比例再跳变。
			await walkCorrectImageSizesByAspect(tree);
			// 加载期间文件已切换：丢弃过期结果
			if (this.loadingFilePath !== file.path) {
				return;
			}
			window.requestAnimationFrame(() => {
				if (this.loadingFilePath !== file.path) {
					return;
				}
				this.initMindMap(tree);
			});
		} catch (error) {
			// 文件可能已被删除/损坏：保持视图可用并提示，避免半加载状态
			this.loadingFilePath = null;
			console.error('加载思维导图失败:', file.path, error);
			new Notice(`${t(this.lang, 'common.notLoaded')}`);
		}
	}

	/** 解析文件内容：Markdown 大纲 → 导图树（渲染层定位，无专有格式分支） */
	private parseDocument(
		content: string,
		file: TFile,
	): MindMapTreeNode {
		this.mdDocumentMode = isMindMapMarkdownFile(file);
		// 记录进入前 markdown 模式（「以 Markdown 编辑」返回时恢复）
		const state = this.leaf.getViewState().state as {
			mdBackMode?: 'source' | 'preview';
		};
		this.mdBackMode = state?.mdBackMode ?? 'source';
		// 根（中心主题）文本 = 文件名（去 .mindmap 后缀）；改名见 scheduleTitleRename
		const rootName = file.basename.replace(/\.mindmap$/i, '') || file.basename;
		const parsed = parseMdOutline(content, rootName);
		this.mdFrontmatter = parsed.frontmatter;
		const tree = parsed.tree;
		// 图片：库内路径/外链 → 资源地址（mdImageTarget 保留原目标串，供回写）
		walkResolveImagePaths(tree, this.app);
		normalizeImageSizes(tree);
		return tree;
	}

	initMindMap(tree: MindMapTreeNode): void {
		if (!this.canvasEl) {
			return;
		}
		// 每次新的初始化请求递增代际，令旧的零尺寸重试作废。重试闭包与
		// 本入口共用同一代际 + isConnected 双重守卫：文件切换（onUnloadFile/
		// 新的 initMindMap）或视图关闭（onClose）都会让旧请求静默退出，
		// 杜绝过期 tree 覆盖当前文件内容。
		const seq = ++this.initSeq;
		const attempt = (): void => {
			if (
				!this.canvasEl ||
				!this.canvasEl.isConnected ||
				this.initSeq !== seq
			) {
				return;
			}
			const rect = this.canvasEl.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) {
				// 容器暂时不可见（后台叶/折叠面板）：定时重试而非 rAF 忙循环，
				// 后台标签页由浏览器自动节流，恢复可见后必然初始化成功。
				window.setTimeout(attempt, 200);
				return;
			}
			this.renderMindMap(tree);
		};
		attempt();
	}

	/** 引擎实际创建（仅在 initMindMap 的守卫通过后调用一次） */
	private renderMindMap(tree: MindMapTreeNode): void {
		if (!this.canvasEl) {
			return;
		}
		// 修复缺失/重复的 uid（避免引擎按 uid 查找节点时误删/漏删）
		ensureUniqueUids(tree);
		this.destroyMindMapInstance();
		this.canvasEl.empty();
		// 布局持久化在视图状态存储（.mindmap.md 正文不写入布局）
		const layout: string =
			this.currentLayout || this.plugin.settings.defaultLayout;
		this.currentLayout = layout;
		this.mindMap = createMindMap(this.canvasEl, tree, {
			layout: layout,
			themePref: this.plugin.settings.defaultTheme,
			isDark: this.isDark,
			enableDrag: this.plugin.settings.enableDrag,
			performanceMode: this.plugin.settings.performanceMode,
			performanceThreshold: this.plugin.settings.performanceThreshold,
			lang: this.lang,
			onHyperlinkJump: (link) => this.openHyperlink(link),
		});
		if (this.layoutSelect) {
			this.layoutSelect.value = layout;
		}
		this.engineEvents.onEngine(this.mindMap, 'data_change', () => {
			this.scheduleSave();
			updateStatusBar(this);
			this.scheduleTitleRename();
		});
		// 点击节点图片 → 全屏查看（灯箱）
		this.engineEvents.onEngine(this.mindMap, 'node_img_click', (...args: unknown[]) => {
			const node = args[0] as MindMapNode | undefined;
			if (!node) {
				return;
			}
			// 拖拽刚结束（落点仍在图片上）时浏览器仍会触发 click：
			// 忽略，避免拖拽节点后误开灯箱
			if (Date.now() - this.lastNodeDragEndAt < 300) {
				return;
			}
			openNodeImageFullscreen(this, node);
		});
		this.engineEvents.onEngine(this.mindMap, 'node_dragend', () => {
			this.lastNodeDragEndAt = Date.now();
		});
		this.mindMap.render();
		updateStatusBar(this);
		setupDragAndDrop(this);
		setupPasteHandler(this);
		setupContextMenu(this);
		registerWikilinkInteractions(this);
		// md 文档模式：onOpen 构建工具栏时文件尚未加载（mdDocumentMode=false），
		// 加载完成后重建工具栏以补上「以 Markdown 编辑」返回按钮
		if (this.mdDocumentMode) {
			this.refreshToolbar();
			if (this.layoutSelect && this.currentLayout) {
				this.layoutSelect.value = this.currentLayout;
			}
		}
		// 首帧后：有保存的视口（缩放/平移）则恢复，否则适配全图
		window.setTimeout(() => this.restoreOrFitViewport(), 150);
	}

	/** 打开后恢复保存的视口；无则 fit 全图 */
	private restoreOrFitViewport(): void {
		const file = this.file;
		const mindMap = this.mindMap;
		if (!file || !mindMap) {
			return;
		}
		const savedView = this.plugin.viewState.getView(file.path);
		try {
			if (savedView) {
				mindMap.view.setTransformData(savedView);
			} else {
				fitMindMap(mindMap);
			}
		} catch (error) {
			console.error('恢复视图状态失败', error);
			fitMindMap(mindMap);
		}
	}

	/**
	 * 中心主题 ⇄ 文件名同步：根节点文本编辑停止（防抖 + 非编辑态）后，
	 * 把 .mindmap.md 文件重命名为该文本（Obsidian 原生更新链接/反链）。
	 * 双向：外部改名后视图重载，中心随新文件名。md 正文不承载根行。
	 */
	private titleRenameTimer: number | null = null;

	private scheduleTitleRename(): void {
		if (!this.file) {
			return;
		}
		if (this.titleRenameTimer !== null) {
			window.clearTimeout(this.titleRenameTimer);
		}
		this.titleRenameTimer = window.setTimeout(() => {
			this.titleRenameTimer = null;
			void this.performTitleRename();
		}, 1500);
	}

	private async performTitleRename(): Promise<void> {
		const file = this.file;
		const mindMap = this.mindMap;
		if (!file || !mindMap || !isMindMapMarkdownFile(file)) {
			return;
		}
		// 仍在文本编辑框内（用户正打字）→ 等编辑结束后再触发
		const textEdit = (
			mindMap.renderer as unknown as {
				textEdit?: { isShowTextEdit(): boolean };
			}
		).textEdit;
		if (textEdit?.isShowTextEdit()) {
			this.scheduleTitleRename();
			return;
		}
		const rootText = mindMap.renderer.root?.getData('text');
		const title = typeof rootText === 'string' ? rootText.trim() : '';
		const sanitized = sanitizeFileName(title).trim();
		const base = file.basename.replace(/\.mindmap$/i, '');
		if (!sanitized || sanitized === base) {
			return; // 未改名或非法名
		}
		const folder = file.parent ? `${file.parent.path}/` : '';
		const newPath = `${folder}${sanitized}.mindmap.md`;
		if (newPath === file.path) {
			return;
		}
		if (this.app.vault.getAbstractFileByPath(newPath)) {
			new Notice(t(this.lang, 'rename.titleConflict'));
			return;
		}
		try {
			await this.app.vault.rename(file, newPath);
		} catch (error) {
			console.error('根据中心主题重命名文件失败', error);
			new Notice(t(this.lang, 'rename.titleFailed'));
		}
	}

	/** 持久化当前视口（关闭/卸载/切回 Markdown 前调用） */
	private persistViewport(): void {
		const file = this.file;
		if (file && this.mindMap?.view) {
			try {
				this.plugin.viewState.setView(
					file.path,
					this.mindMap.view.getTransformData(),
				);
			} catch {
				// 引擎尚未就绪等场景忽略
			}
		}
	}

	/**
	 * 切换布局（工具栏调用）：更新会话字段 + 立即写入视图状态存储
	 * （.mindmap.md 布局不写入正文，存 data.json 按文件路径恢复）。
	 */
	applyLayout(value: string): void {
		this.currentLayout = value;
		if (this.mindMap) {
			this.mindMap.setLayout(value);
		}
		if (this.file) {
			this.plugin.viewState.setLayout(this.file.path, value);
		}
	}

	/** 重建思维导图实例（设置变更后调用） */
	refreshMindMap(): void {
		if (!this.mindMap) {
			return;
		}
		const data = this.mindMap.getData();
		this.initMindMap(data);
	}

	private applyTheme(): void {
		if (!this.mindMap) {
			return;
		}
		const dark = isDarkTheme(this.plugin.settings.defaultTheme, this.isDark);
		this.mindMap.setThemeConfig(getThemeConfig(dark));
	}

	/** 安排一次防抖自动保存（view-toolbar.ts / view-node-actions.ts 等外部模块调用） */
	scheduleSave(): void {
		if (!this.plugin.settings.autoSave || !this.file) {
			return;
		}
		if (this.saveTimeout) {
			window.clearTimeout(this.saveTimeout);
		}
		this.saveTimeout = window.setTimeout(() => {
			void this.save();
		}, SAVE_DELAY_MS);
	}

	private async save(): Promise<void> {
		if (!this.file) {
			return;
		}
		// 文件已被删除时不应重新保存：Obsidian 删除 .mindmap 会触发 onUnloadFile，
		// 此时若继续 vault.modify，会重建已被删除的文件（表现为"要删两次"）。
		if (!this.app.vault.getAbstractFileByPath(this.file.path)) {
			return;
		}
		if (this.saveInProgress) {
			// 写入进行中：标记待写并立即快照最新数据。
			// 视图卸载（onUnloadFile/onClose）时引擎可能随即被销毁，
			// 提前快照保证最后一批编辑不丢失。
			this.savePending = true;
			if (this.mindMap) {
				this.pendingTree = this.mindMap.getData();
			}
			return this.saveChain;
		}
		const file = this.file;
		this.saveInProgress = true;
		this.saveChain = (async () => {
			// 循环排空：写盘期间若又有编辑（savePending），继续写最新快照
			let tree = this.mindMap?.getData() ?? null;
			while (
				tree &&
				this.app.vault.getAbstractFileByPath(file.path)
			) {
				try {
					// 序列化为 md 大纲 + 原样 frontmatter（布局不入文件）
					const body = serializeMdBody(tree, this.app);
					let content = this.mdFrontmatter
						? this.mdFrontmatter.endsWith('\n')
							? this.mdFrontmatter + body
							: `${this.mdFrontmatter}\n${body}`
						: body;
					if (!content.endsWith('\n')) {
						content += '\n';
					}
					await this.app.vault.modify(file, content);
				} catch (error) {
					console.error('保存思维导图失败', error);
				}
				if (!this.savePending) {
					tree = null;
					break;
				}
				this.savePending = false;
				tree = this.mindMap?.getData() ?? this.pendingTree;
				this.pendingTree = null;
			}
			this.saveInProgress = false;
		})();
		return this.saveChain;
	}

	// ==================== 工具栏（委托 view-toolbar.ts） ====================

	/** 自动整理（需求 3）：重新按布局算法对齐摆放各主题并适配画布 */
	arrangeMindMap(): void {
		arrangeMindMap(this);
	}

	/** 设置变更后重建工具栏 */
	refreshToolbar(): void {
		refreshToolbar(this);
	}

	/** md 文档模式：切回 Markdown 编辑/阅读（恢复进入前模式） */
	backToMarkdown(): void {
		if (this.file) {
			this.persistViewport();
			// 双向偏好：显式选择以 Markdown 查看 → 下次默认打开方式
			this.plugin.viewState.setOpenAs(this.file.path, 'markdown');
			void openAsMarkdown(this.leaf, this.file, this.mdBackMode);
		}
	}

	// ==================== 搜索栏（委托 view-search.ts） ====================

	private buildSearchBar(): void {
		buildSearchBar(this);
	}

	openSearchBar(): void {
		openSearchBar(this);
	}

	closeSearchBar(): void {
		closeSearchBar(this);
	}

	private doSearch(): void {
		doSearch(this);
	}

	private searchNext(): void {
		searchNext(this);
	}

	private searchPrev(): void {
		searchPrev(this);
	}

	private updateSearchCount(): void {
		updateSearchCount(this);
	}

	// ==================== 导出（委托 view-export.ts） ====================

	async exportPNG(): Promise<void> {
		await exportPNG(this);
	}

	// ==================== 链接跳转 / 引用更新 / 清理 ====================

	/**
	 * 打开节点超链接（wiki 链接 / http / 库内路径）。
	 * @param openNew true = 新标签页打开（Ctrl/Cmd+点击语义）
	 */
	openHyperlink(link: string, openNew = false): void {
		if (!link) {
			return;
		}
		const sourcePath = this.file?.path ?? '';
		const wikiMatch = link.match(/^\[\[([^\]]+)\]\]$/);
		if (wikiMatch && wikiMatch[1]) {
			// 解析 [[目标]] 到具体库内文件：Obsidian 可渲染才开标签页；
			// 系统媒体（音频/视频）走系统应用；其余类型不开空白页
			const inner =
				(wikiMatch[1] ?? '').split('|')[0]?.split('#')[0] ?? wikiMatch[1];
			const dest = this.app.metadataCache.getFirstLinkpathDest(
				inner,
				sourcePath,
			);
			if (dest && !canOpenInObsidian(dest.extension)) {
				if (isSystemMediaExtension(dest.extension)) {
					openFileWithSystemApp(this.app, dest, this.lang);
				} else {
					new Notice(t(this.lang, 'common.cannotPreview'));
				}
				return;
			}
			void this.app.workspace.openLinkText(
				wikiMatch[1],
				sourcePath,
				openNew ? 'tab' : false,
			);
			return;
		}
		if (link.startsWith('http://') || link.startsWith('https://')) {
			window.open(link, '_blank');
			return;
		}
		// 其余按库内路径处理：Obsidian 可渲染才开标签页；系统媒体走系统应用；其余不开空白页
		const file = resolvePathToFile(link, this.app);
		if (file && !canOpenInObsidian(file.extension)) {
			if (isSystemMediaExtension(file.extension)) {
				openFileWithSystemApp(this.app, file, this.lang);
			} else {
				new Notice(t(this.lang, 'common.cannotPreview'));
			}
			return;
		}
		void this.app.workspace.openLinkText(
			link,
			sourcePath,
			openNew ? 'tab' : false,
		);
	}

	updateReferencesOnRename(file: TFile, oldPath: string): void {
		if (!this.mindMap) {
			return;
		}
		// 性能：渲染器树预检（零拷贝），无关文件的重命名直接跳过，
		// 避免每次全库重命名都对每个打开的导图做深拷贝 + 全量重渲染。
		if (!this.rendererTreeHasMatchingRef(file, oldPath)) {
			return;
		}
		const tree = this.mindMap.getData();
		if (updateReferencesOnRename(tree, file, oldPath, this.app)) {
			this.mindMap.setData(tree);
			this.scheduleSave();
		}
	}

	updateReferencesOnDelete(file: TFile): void {
		if (!this.mindMap) {
			return;
		}
		// 性能：同 updateReferencesOnRename——预检零拷贝，无关文件删除直接跳过
		if (!this.rendererTreeHasMatchingRef(file, file.path)) {
			return;
		}
		const tree = this.mindMap.getData();
		if (removeReferencesOnDelete(tree, file, this.app)) {
			this.mindMap.setData(tree);
			this.scheduleSave();
		}
	}

	private destroyMindMapInstance(): void {
		// 一次性清理本引擎实例作用域的全部 DOM/引擎事件
		// （dragover/drop/contextmenu/mouseover/paste + data_change/node_* 等），
		// 替代原 10+ 个 boundHandle* 字段的逐一手動 removeEventListener/off。
		this.engineEvents.destroy();
		destroyMindMap(this.mindMap);
		this.mindMap = null;
		this.canvasEl?.empty();
	}

	/**
	 * 渲染器树快速预检：树内是否有任何节点的图片/附件/超链接可能指向
	 * 指定文件（重命名/删除）。命中才走 getData() 深拷贝 + 精确匹配 + setData 重渲染；
	 * 未命中（无关文件的重命名/删除）时零拷贝跳过。
	 * 子串匹配是保守近似（宁可误报触发精确路径，不可漏报导致引用残留）。
	 */
	private rendererTreeHasMatchingRef(file: TFile, oldPath: string): boolean {
		const root = this.mindMap?.renderer?.root;
		if (!root) {
			return false;
		}
		const oldBasename = (oldPath.split('/').pop() ?? '').replace(
			/\.[^.]+$/,
			'',
		);
		const needles = [
			file.name,
			oldPath,
			oldBasename,
			encodeURIComponent(file.name),
		];
		let found = false;
		const walk = (node: MindMapNode): void => {
			if (found) {
				return;
			}
			const data = node.getData() as MindMapNodeData;
			if (data?.image || data?.attachmentUrl || data?.hyperlink) {
				const haystack = `${data.image ?? ''}|${data.attachmentUrl ?? ''}|${data.hyperlink ?? ''}`;
				if (needles.some((needle) => haystack.includes(needle))) {
					found = true;
					return;
				}
			}
			node.children.forEach(walk);
		};
		walk(root);
		return found;
	}

	async onClose(): Promise<void> {
		// 视图关闭：作废尚未执行的初始化重试（容器即将脱离 DOM）
		this.initSeq++;
		if (this.saveTimeout) {
			window.clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
		if (this.titleRenameTimer !== null) {
			window.clearTimeout(this.titleRenameTimer);
			this.titleRenameTimer = null;
		}
		if (this.statusBarTrailingTimer !== null) {
			window.clearTimeout(this.statusBarTrailingTimer);
			this.statusBarTrailingTimer = null;
		}
		this.persistViewport();
		await this.save();
		// 清理视图生命周期作用域的事件（搜索输入框 input/keydown 等）
		this.viewEvents.destroy();
		this.destroyMindMapInstance();
		if (this.plugin.statusBarEl) {
			this.plugin.statusBarEl.setText('');
			// 仍有其他打开的思维导图视图时，恢复其节点计数
			//（状态栏为插件级共享元素，本视图关闭不应清空其他视图的计数）。
			this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
				const other = leaf.view;
				if (other instanceof MindMapView && other !== this && other.mindMap) {
					updateStatusBar(other);
				}
			});
		}
	}

	onResize(): void {
		this.mindMap?.resize();
	}
}
