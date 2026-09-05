import {
	App,
	PluginSettingTab,
	type SettingDefinitionItem,
} from 'obsidian';
import TheMindMapPlugin from './main';
import { LAYOUT_OPTIONS, THEME_OPTIONS } from './constants';
import { Language, LANGUAGE_OPTIONS, t } from './i18n';

/** 插件设置 */
export interface TheMindMapSettings {
	defaultLayout: string;
	defaultTheme: string;
	autoSave: boolean;
	exportScale: number;
	codeBlockDefaultLayout: string;
	enableDrag: boolean;
	performanceMode: boolean;
	performanceThreshold: number;
	language: Language;
}

export const DEFAULT_SETTINGS: TheMindMapSettings = {
	defaultLayout: 'logicalStructure',
	defaultTheme: 'default',
	autoSave: true,
	exportScale: 2,
	codeBlockDefaultLayout: 'logicalStructure',
	enableDrag: true,
	// 默认开启性能模式：节点数超过阈值（performanceThreshold）时自动启用
	// 虚拟渲染（仅渲染可视区域节点）。用户可在此关闭。
	performanceMode: true,
	performanceThreshold: 500,
	language: 'zh',
};

/** 变更后需要即时应用到已打开视图的设置项（与 display() 的 onChange 行为一致） */
const LIVE_REFRESH_SETTING_KEYS = new Set<string>([
	'defaultLayout',
	'defaultTheme',
	'enableDrag',
	'performanceMode',
	'performanceThreshold',
	'language',
]);

/** 设置面板 */
export class TheMindMapSettingTab extends PluginSettingTab {
	plugin: TheMindMapPlugin;

	constructor(app: App, plugin: TheMindMapPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** 当前界面语言 */
	private get lang(): Language {
		return this.plugin.settings.language;
	}

	/**
	 * 声明式设置定义（Obsidian 1.13+）：
	 * 新版本用它渲染设置页并获得设置搜索支持；
	 * 1.13 以下自动忽略本方法、回退到 display()。
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const layoutOptions = Object.fromEntries(
			LAYOUT_OPTIONS.map((option) => [
				option.value,
				t(this.lang, option.label),
			]),
		);
		const themeOptions = Object.fromEntries(
			THEME_OPTIONS.map((option) => [
				option.value,
				t(this.lang, option.label),
			]),
		);
		// 语言下拉选项（label 用语言自身的名字，不随界面语言变化）
		const languageOptions = Object.fromEntries(
			LANGUAGE_OPTIONS.map((option) => [option.value, option.label]),
		);
		return [
			{
				type: 'group',
				heading: t(this.lang, 'settings.title'),
			items: [
				{
					name: t(this.lang, 'settings.language'),
					desc: t(this.lang, 'settings.languageDesc'),
						control: {
							type: 'dropdown',
							key: 'language',
							options: languageOptions,
						},
					},
					{
						name: t(this.lang, 'settings.defaultLayout'),
						desc: t(this.lang, 'settings.defaultLayoutDesc'),
						control: {
							type: 'dropdown',
							key: 'defaultLayout',
							options: layoutOptions,
						},
					},
					{
						name: t(this.lang, 'settings.defaultTheme'),
						desc: t(this.lang, 'settings.defaultThemeDesc'),
						control: {
							type: 'dropdown',
							key: 'defaultTheme',
							options: themeOptions,
						},
					},
					{
						name: t(this.lang, 'settings.autoSave'),
						desc: t(this.lang, 'settings.autoSaveDesc'),
						control: { type: 'toggle', key: 'autoSave' },
					},
					{
						name: t(this.lang, 'settings.enableDrag'),
						desc: t(this.lang, 'settings.enableDragDesc'),
						control: { type: 'toggle', key: 'enableDrag' },
					},
					{
						name: t(this.lang, 'settings.performanceMode'),
						desc: t(this.lang, 'settings.performanceModeDesc'),
						control: { type: 'toggle', key: 'performanceMode' },
					},
					{
						name: t(this.lang, 'settings.performanceThreshold'),
						desc: t(this.lang, 'settings.performanceThresholdDesc'),
						control: {
							type: 'slider',
							key: 'performanceThreshold',
							min: 100,
							max: 2000,
							step: 100,
						},
					},
					{
						name: t(this.lang, 'settings.exportScale'),
						desc: t(this.lang, 'settings.exportScaleDesc'),
						control: {
							type: 'slider',
							key: 'exportScale',
							min: 1,
							max: 4,
							step: 1,
						},
					},
					{
						name: t(this.lang, 'settings.codeBlockLayout'),
						desc: t(this.lang, 'settings.codeBlockLayoutDesc'),
						control: {
							type: 'dropdown',
							key: 'codeBlockDefaultLayout',
							options: layoutOptions,
						},
					},
				],
			},
		];
	}

	/**
	 * 声明式设置写回（1.13+）：变更设置、持久化，
	 * 并按需即时应用到已打开的视图（与 display() 的 onChange 行为一致）。
	 */
	override setControlValue(key: string, value: unknown): void {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] =
			value;
		void this.plugin.saveSettings();
		if (LIVE_REFRESH_SETTING_KEYS.has(key)) {
			this.plugin.applySettingsToViews();
		}
		// 语言切换后重渲染设置面板以刷新语言。
		// Obsidian 1.13+ 由 getSettingDefinitions() 声明式渲染，display() 已被弃用；
		// 直接调用 display() 会清空容器并叠加一套命令式控件，与声明式渲染冲突，
		// 导致设置面板时而中文时而英文。改用 update() 重新求值并重渲染（仅 1.13+ 走这里）。
		if (key === 'language') {
			this.update();
		}
	}

}
