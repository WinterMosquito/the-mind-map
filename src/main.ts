/**
 * The Mind Map —— Obsidian 思维导图插件入口。
 *
 * 生命周期职责（遵循 obsidian-sample-plugin 规范）：
 * - onload: 注册视图/扩展名/代码块处理器/事件监听/设置面板
 * - onunload: 清理
 * 业务逻辑分别位于 settings.ts / commands.ts / creation.ts / view.ts /
 * codeblock.ts / mindmap.ts / images.ts / links.ts / markdown.ts / modals.ts。
 */
import {
	MarkdownView,
	Menu,
	Plugin,
	TFile,
	TFolder,
} from 'obsidian';
import {
	CODE_BLOCK_LANGUAGE,
	VIEW_TYPE,
} from './constants';
import {
	DEFAULT_SETTINGS,
	TheMindMapSettings,
	TheMindMapSettingTab,
} from './settings';
import { MindMapView } from './view';
import { MindMapCodeBlock } from './codeblock';
import { createNewMindMap } from './creation';
import {
	isMindMapMarkdownFile,
	openAsMarkdown,
	openAsMindMap,
	setOpenAsPreferenceHook,
} from './md-open';
import { registerCommands } from './commands';
import { t } from './i18n';
import { VaultSyncService } from './vault-sync';
import { ViewStateStore } from './view-state';

/**
 * 校验/归一化从 data.json 读出的设置。历史或手工数据可能含非法类型
 * （如 language:'fr'、exportScale:'2'、performanceThreshold:'abc'），
 * 直接 Object.assign 会让坏值覆盖默认值并流入运算（NaN/错误语言回退）。
 * 只采纳「类型正确 + 取值合法」的键，其余用默认值。
 */
function sanitizeSettings(raw: Record<string, unknown>): TheMindMapSettings {
	const pickString = (key: keyof TheMindMapSettings): string | undefined => {
		const value = raw[key];
		return typeof value === 'string' ? value : undefined;
	};
	const pickNumber = (key: keyof TheMindMapSettings): number | undefined => {
		const value = raw[key];
		const num =
			typeof value === 'number'
				? value
				: typeof value === 'string' && value.trim() !== ''
					? Number(value)
					: NaN;
		return Number.isFinite(num) ? num : undefined;
	};
	const pickBool = (key: keyof TheMindMapSettings): boolean | undefined => {
		const value = raw[key];
		return typeof value === 'boolean' ? value : undefined;
	};
	const language = pickString('language');
	return {
		defaultLayout:
			pickString('defaultLayout') ?? DEFAULT_SETTINGS.defaultLayout,
		defaultTheme: pickString('defaultTheme') ?? DEFAULT_SETTINGS.defaultTheme,
		autoSave: pickBool('autoSave') ?? DEFAULT_SETTINGS.autoSave,
		exportScale: pickNumber('exportScale') ?? DEFAULT_SETTINGS.exportScale,
		codeBlockDefaultLayout:
			pickString('codeBlockDefaultLayout') ??
			DEFAULT_SETTINGS.codeBlockDefaultLayout,
		enableDrag: pickBool('enableDrag') ?? DEFAULT_SETTINGS.enableDrag,
		performanceMode:
			pickBool('performanceMode') ?? DEFAULT_SETTINGS.performanceMode,
		performanceThreshold:
			pickNumber('performanceThreshold') ??
			DEFAULT_SETTINGS.performanceThreshold,
		language:
			language === 'zh' || language === 'en'
				? language
				: DEFAULT_SETTINGS.language,
	};
}

export default class TheMindMapPlugin extends Plugin {
	settings!: TheMindMapSettings;
	statusBarEl: HTMLElement | null = null;
	/** 视图状态（布局/视口，按文件路径）——与设置合并写 data.json */
	viewState = new ViewStateStore((state) => {
		void this.commitData({ viewState: state });
	}, 600);
	private layoutReadyCallback: (() => void) | null = null;
	/** Vault 文件事件同步服务（rename/delete/create） */
	private vaultSync!: VaultSyncService;

	async onload(): Promise<void> {
		await this.loadSettings();

		// 「以思维导图打开」→ 记录打开方式偏好（双向：最后一次主动选择决定下次）
		setOpenAsPreferenceHook((path) => {
			this.viewState.setOpenAs(path, 'mindmap');
		});

		this.registerView(VIEW_TYPE, (leaf) => new MindMapView(leaf, this));

		// 悬停预览源：导图节点上的 [[wikilink]] 触发 Obsidian 原生页面预览
		// （core 只处理已注册 hoverLinkSource 的事件，未注册会静默忽略）
		this.registerHoverLinkSource(VIEW_TYPE, {
			display: 'The Mind Map',
			defaultMod: false,
		});

		// 命令面板命令与丝带图标（用户入口）
		registerCommands(this);

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.setText(t(this.settings.language, 'common.mindMap'));

		// 文件右键：.mindmap.md 以思维导图打开；文件夹右键：新建思维导图
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && isMindMapMarkdownFile(file)) {
					menu.addItem((item) =>
						item
							.setTitle(t(this.settings.language, 'command.openAsMindMap'))
							.setIcon('dot-network')
							.onClick(() => {
								void openAsMindMap(this.app.workspace.getLeaf(false), file);
							}),
					);
					menu.addItem((item) =>
						item
							.setTitle(t(this.settings.language, 'command.openAsMarkdown'))
							.setIcon('file-text')
							.onClick(() => {
								// 先写偏好再打开：避免 active-leaf-change 自动切回导图
								this.viewState.setOpenAs(file.path, 'markdown');
								void openAsMarkdown(
									this.app.workspace.getLeaf(false),
									file,
									'source',
								);
							}),
					);
					return;
				}
				if (file instanceof TFolder) {
					menu.addItem((item) =>
						item
							.setTitle(t(this.settings.language, 'command.createMindMap'))
							.setIcon('dot-network')
							.onClick(() => {
								void createNewMindMap(
									this.app,
									this.settings.language,
									file.path,
								);
							}),
					);
				}
			}),
		);

		// 文件浏览器「新建文件」菜单注入
		this.layoutReadyCallback = () => this.injectIntoFileCreator();
		this.app.workspace.onLayoutReady(this.layoutReadyCallback);
		this.registerEvent(
			this.app.workspace.on('layout-change', () => this.injectIntoFileCreator()),
		);

		// Markdown 代码块渲染
		this.registerMarkdownCodeBlockProcessor(
			CODE_BLOCK_LANGUAGE,
			(source, el, ctx) => {
				const codeBlock = new MindMapCodeBlock(
					this.app,
					this.settings,
					source,
					el,
					ctx.sourcePath,
				);
				ctx.addChild(codeBlock);
			},
		);

		// Vault 文件事件同步（重命名/删除/创建时更新打开导图的引用与查找缓存）
		this.vaultSync = new VaultSyncService(this.app);
		this.vaultSync.attach(this);

		// 视图状态（布局/视口）随文件改名/删除迁移键或清理
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && isMindMapMarkdownFile(file)) {
					this.viewState.renameKey(oldPath, file.path);
				} else {
					this.viewState.removeKey(oldPath);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				this.viewState.removeKey(file.path);
			}),
		);

		// 打开方式记忆：偏好为 mindmap 的 .mindmap.md 以 markdown 视图被激活时，
		// 自动切入导图视图（重新打开仍为思维导图）。
		// 用 active-leaf-change（携带已激活 leaf）而非 file-open（时序上活动视图
		// 可能尚未切换为 markdown，会导致漏判）。
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (!leaf || leaf.view instanceof MindMapView) {
					return; // 已是导图视图（含在导图标签内切换文件）
				}
				const markdownView = leaf.view;
				if (!(markdownView instanceof MarkdownView)) {
					return;
				}
				const file = markdownView.file;
				if (!file || !isMindMapMarkdownFile(file)) {
					return;
				}
				if (this.viewState.getOpenAs(file.path) !== 'mindmap') {
					return;
				}
				void openAsMindMap(leaf, file);
			}),
		);

		this.addSettingTab(new TheMindMapSettingTab(this.app, this));
	}

	onunload(): void {
		// 排空未落盘的视图状态（防抖定时器）
		this.viewState.flushNow?.();
		this.statusBarEl = null;
	}

	async loadSettings(): Promise<void> {
		let data: unknown;
		try {
			data = await this.loadData();
		} catch (error) {
			// 配置读取失败（如 data.json 被占用/损坏）不应拖垮插件启动
			console.error('读取插件配置失败，回退默认设置', error);
			data = null;
		}
		// 非对象 data.json（数组/字符串等）会把索引当键展开，必须丢弃
		if (data === null || typeof data !== 'object' || Array.isArray(data)) {
			data = {};
		}
		const raw = data as Record<string, unknown>;
		this.viewState.hydrate(raw.viewState);
		delete raw.viewState;
		this.settings = sanitizeSettings(raw);
	}

	/**
	 * 合并写盘（历史格式：设置位于 data.json 顶层；viewState 为额外顶层键）。
	 * 每次写前重读合并，避免设置/视图状态互相覆盖。
	 */
	async saveSettings(): Promise<void> {
		await this.commitData({ ...this.settings, viewState: this.viewState.serialize() });
	}

	private async commitData(data: Record<string, unknown>): Promise<void> {
		const current: Record<string, unknown> =
			((await this.loadData()) as Record<string, unknown> | null) ?? {};
		await this.saveData({ ...current, ...data });
	}

	/** 设置变更后应用到所有打开的思维导图视图 */
	applySettingsToViews(): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
			const view = leaf.view;
			if (view instanceof MindMapView) {
				view.refreshToolbar();
				view.refreshMindMap();
			}
		});
	}

	/**
	 * 向文件浏览器的「新建」菜单注入「新建思维导图」。
	 *
	 * ⚠️ 私有 API 风险说明：Obsidian 未公开注入 fileCreator 菜单的公共 API
	 * （obsidian.d.ts 仅有 file-menu / files-menu 事件，且无 fileCreator 类型），
	 * 本实现采用社区通行的防御式访问（Templater 等插件同款做法）：
	 * - 特性检测：fileCreator / menu 缺失或结构变化时静默跳过，不崩溃；
	 * - 菜单重建检测：以菜单对象引用作为注入标记，Obsidian 重建菜单对象后
	 *   引用变化会自动重新注入（旧标记为布尔值，菜单重建后会失效）；
	 * - 整体 try/catch：私有 API 变更抛异常时静默降级，不影响插件其他功能。
	 * 若未来 Obsidian 提供公共 API，应优先替换为公共实现。
	 */
	private injectIntoFileCreator(): void {
		try {
			this.app.workspace.getLeavesOfType('file-explorer').forEach((leaf) => {
				const explorerView = leaf.view as unknown as {
					fileCreator?: { menu?: Menu; folder?: TFolder | null } | null;
					/** 已注入的菜单对象引用（菜单重建后重新注入） */
					_mindMapInjectedMenu?: Menu | null;
				};
				const fileCreator = explorerView.fileCreator;
				// 特性检测：私有 API 不存在或结构变化时静默跳过
				if (!fileCreator?.menu) {
					return;
				}
				// 同一菜单对象已注入过则跳过；
				// 菜单对象被 Obsidian 重建（引用变化）时重新注入
				if (explorerView._mindMapInjectedMenu === fileCreator.menu) {
					return;
				}
				fileCreator.menu.addItem((item) =>
					item
						.setTitle(t(this.settings.language, 'command.createMindMap'))
						.setIcon('dot-network')
						.onClick(() => {
							void createNewMindMap(
								this.app,
								this.settings.language,
								fileCreator.folder?.path ?? '',
							);
						}),
				);
				explorerView._mindMapInjectedMenu = fileCreator.menu;
			});
		} catch (error) {
			// 私有 API 变更时静默降级：命令面板 / 文件夹右键 / 丝带图标
			// 等公共入口不受影响
			console.debug(
				'注入文件浏览器「新建」菜单失败（Obsidian 私有 API 可能已变更）',
				error,
			);
		}
	}
}
