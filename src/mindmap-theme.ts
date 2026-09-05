/**
 * simple-mind-map 引擎主题配置：亮/暗色配色、视图与代码块主题。
 * 从 mindmap.ts 拆出。
 */
import { IMAGE_HEIGHT, IMAGE_WIDTH } from './constants';

const BORDER_RADIUS = 5;

interface ThemeColors {
	primary: string;
	rootFill: string;
	rootText: string;
	secondFill: string;
	secondText: string;
	nodeFill: string;
	nodeText: string;
	border: string;
	line: string;
}

const LIGHT_COLORS: ThemeColors = {
	primary: '#4a90d9',
	rootFill: '#4a90d9',
	rootText: '#ffffff',
	secondFill: '#e8f0fe',
	secondText: '#333333',
	nodeFill: '#ffffff',
	nodeText: '#333333',
	border: '#4a90d9',
	line: '#4a90d9',
};

const DARK_COLORS: ThemeColors = {
	primary: '#555555',
	rootFill: '#2d2d2d',
	rootText: '#e0e0e0',
	secondFill: '#252525',
	secondText: '#d0d0d0',
	nodeFill: '#1e1e1e',
	nodeText: '#c0c0c0',
	border: '#555555',
	line: '#555555',
};

/** 判断指定主题偏好下是否使用暗色配色 */
export function isDarkTheme(themePref: string, isDark: boolean): boolean {
	return themePref === 'dark' || (themePref === 'default' && isDark);
}

/**
 * 思维导图视图的主题配置。
 * imgMaxWidth/imgMaxHeight 使用统一的固定图片尺寸，
 * 保证所有图片等高且完整呈现在子主题框架内。
 */
export function getThemeConfig(isDark: boolean): Record<string, unknown> {
	const colors: ThemeColors = isDark ? DARK_COLORS : LIGHT_COLORS;
	return {
		backgroundColor: isDark ? '#1e1e1e' : '#ffffff',
		imgMaxWidth: IMAGE_WIDTH,
		imgMaxHeight: IMAGE_HEIGHT,
		root: {
			fillColor: colors.rootFill,
			color: colors.rootText,
			fontSize: 16,
			fontWeight: 'bold',
			borderColor: 'transparent',
			borderWidth: 0,
			borderRadius: BORDER_RADIUS,
		},
		second: {
			fillColor: colors.secondFill,
			color: colors.secondText,
			fontSize: 14,
			borderColor: colors.border,
			borderWidth: 1,
			borderRadius: BORDER_RADIUS,
		},
		node: {
			fillColor: colors.nodeFill,
			color: colors.nodeText,
			fontSize: 13,
			borderColor: colors.border,
			borderWidth: 1,
			borderRadius: BORDER_RADIUS,
		},
		lineColor: colors.line,
		lineWidth: 2,
		...(isDark
			? {
					expandBtnStyle: {
						color: '#999',
						fill: '#333',
						strokeColor: '#666',
					},
				}
			: {}),
	};
}

/** Markdown 代码块中思维导图的主题配置（透明背景、更小字号） */
export function getCodeBlockThemeConfig(
	isDark: boolean,
): Record<string, unknown> {
	const colors: ThemeColors = isDark ? DARK_COLORS : LIGHT_COLORS;
	return {
		backgroundColor: 'transparent',
		imgMaxWidth: IMAGE_WIDTH,
		imgMaxHeight: IMAGE_HEIGHT,
		root: {
			fillColor: colors.rootFill,
			color: colors.rootText,
			fontSize: 15,
			fontWeight: 'bold',
			borderColor: 'transparent',
			borderWidth: 0,
			borderRadius: BORDER_RADIUS,
		},
		second: {
			fillColor: colors.secondFill,
			color: colors.secondText,
			fontSize: 13,
			borderColor: colors.border,
			borderWidth: 1,
			borderRadius: BORDER_RADIUS,
		},
		node: {
			fillColor: colors.nodeFill,
			color: colors.nodeText,
			fontSize: 12,
			borderColor: colors.border,
			borderWidth: 1,
			borderRadius: BORDER_RADIUS,
		},
		lineColor: colors.line,
		lineWidth: 2,
		...(isDark
			? {
					expandBtnStyle: {
						color: '#999',
						fill: '#333',
						strokeColor: '#666',
					},
				}
			: {}),
	};
}
