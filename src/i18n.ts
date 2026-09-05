/**
 * 国际化（i18n）：支持中文/英文，设置里切换。
 *
 * 采用 key-based 策略：`t(lang, key)` 从对应语言字典取值。
 * - ZH 字典的 key 集合决定了合法的 TranslationKey（编译期类型检查）
 * - EN 字典缺失时回退到 ZH
 * - 翻译值中可含 {name} / {count} 等占位符，由调用方在模板字符串中拼接
 */

/** 支持的语言 */
export type Language = 'zh' | 'en';

/** 插件设置中的语言选项 */
export const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
	{ value: 'zh', label: '中文' },
	{ value: 'en', label: 'English' },
];

/** 中文字典（key → 中文） */
const ZH = {
	// ===== 命令 =====
	'command.createMindMap': '新建思维导图',
	'command.createInCurrentFolder': '在当前文件文件夹新建思维导图',
	'command.searchNodes': '搜索节点',
	'command.fitCanvas': '适应画布',
	'command.arrange': '自动整理思维导图',
	'command.exportPng': '导出为 PNG',
	'command.created': '思维导图已创建',
	'command.createFailed': '创建思维导图失败：',
	'command.openAsMindMap': '以思维导图打开',
	'command.openAsMarkdown': '以 Markdown 打开',
	'command.backToMarkdown': '以 Markdown 编辑',
	'rename.titleConflict': '已存在同名文件，无法按中心主题重命名',
	'rename.titleFailed': '按中心主题重命名文件失败',

	// ===== 工具栏 =====
	'toolbar.addChild': '添加子节点 (Tab)',
	'toolbar.addSibling': '添加同级节点 (Enter)',
	'toolbar.deleteNode': '删除节点 (Del)',
	'toolbar.undo': '撤销 (Ctrl+Z)',
	'toolbar.redo': '重做 (Ctrl+Y)',
	'toolbar.backToMarkdown': '以 Markdown 编辑',
	'toolbar.undoShort': '撤销',
	'toolbar.redoShort': '重做',
	'toolbar.arrange': '自动整理',
	'toolbar.search': '搜索节点 (Ctrl+F)',
	'toolbar.searchPlaceholder': '搜索节点...',
	'toolbar.insertLink': '插入链接',
	'toolbar.insertImage': '插入图片',
	'toolbar.layout': '布局：',
	'toolbar.zoomIn': '放大',
	'toolbar.zoomOut': '缩小',
	'toolbar.exportPng': '导出 PNG',

	// ===== 右键菜单 =====
	'menu.editText': '编辑文本',
	'menu.addChild': '添加子节点',
	'menu.addSibling': '添加同级节点',
	'menu.copyNode': '复制节点',
	'menu.pasteAsChild': '粘贴为子节点',
	'menu.addLink': '添加链接',
	'menu.addImage': '添加图片',
	'menu.viewImageFullscreen': '全屏查看图片',
	'menu.removeImage': '移除图片',
	'menu.deleteNode': '删除节点',
	'menu.pasteNode': '粘贴节点',

	// ===== 通用提示/通知 =====
	'common.mindMap': '思维导图',
	'common.notLoaded': '思维导图尚未加载',
	'common.arrangeDone': '已自动整理',
	'common.arrangeFailed': '自动整理失败',
	'common.noMatch': '无匹配',
	'common.nodes': '个节点',
	'common.selectNodeFirst': '请先选择一个节点',
	'common.rootCannotDelete': '根节点不可删除',
	'common.clipboardEmpty': '剪贴板为空',
	'common.nodeCopied': '节点已复制',
	'common.selectNodeBeforePasteImage': '请先选择一个节点再粘贴图片',
	'common.savingClipboardImage': '正在保存剪贴板图片...',
	'common.imageSavedTo': '图片已保存到: ',
	'common.pasteImageFailed': '粘贴图片失败: ',
	'common.imageSetOnNode': '已设置节点图片: ',
	'common.linkedTo': '已将节点链接到',
	'common.nodeCreatedAndLinked': '已创建节点并链接到',
	'common.cannotPreview': '无法在 Obsidian 中预览该文件类型',
	'common.cannotOpen': '无法打开该文件类型',
	'common.unknownError': '未知错误',

	// ===== 拖拽/导入 =====
	'common.selectNodeBeforeDropImage': '请先选择一个节点再拖入图片',
	'common.selectNodeBeforeDrop': '请先选择一个节点，再拖入图片',
	'common.onlySupportedFiles':
		'仅支持拖入 Markdown 笔记或图片文件',
	'common.onlyImagesSupported': 'Markdown 导图仅支持图片（音视频/PDF 无法写回）',
	'common.noImagesDropped': '未识别到图片文件',
	'common.importing': '正在导入',
	'common.imagesToVault': '张图片到库中...',
	'common.imported': '已导入',
	'common.imagesStored': '张图片（存储路径遵循「附件存放位置」设置）',

	// ===== 弹窗 - 链接 =====
	'modal.link.title': '设置节点链接',
	'modal.link.placeholder': '输入 URL 或搜索笔记/附件…',
	'modal.link.clear': '清除链接',
	'link.noMatchNote': '未找到匹配的笔记，将使用输入的文本作为链接',

	// ===== 弹窗 - 图片 =====
	'modal.image.title': '设置节点图片',
	'modal.image.urlLabel': '图片 URL 或 Obsidian 内部路径：',
	'modal.image.hint': '输入 URL，或点击下方选择本地图片（自动保存到附件）',
	'modal.image.chooseLocal': '选择本地图片',
	'modal.image.paste': '粘贴图片',
	'modal.image.localHint': '从本地选择图片文件，自动保存到附件目录',
	'modal.image.loadFailed': '图片加载失败',
	'modal.image.none': '无图片',
	'modal.image.saving': '正在保存到附件文件夹...',
	'modal.image.saved': '已保存: ',
	'modal.image.saveFailed': '保存失败',
	'modal.image.noClipboardImage': '剪贴板中没有图片',
	'modal.image.clipboardError': '无法访问剪贴板',
	'modal.image.clear': '清除图片',
	'modal.image.internalPath': '库内路径: ',
	'modal.image.address': '图片地址: ',

	// ===== 弹窗 - 命名 =====
	'modal.name.folder': '文件夹：',
	'modal.name.placeholder': '输入名称...',

	// ===== 通用按钮 =====
	'modal.cancel': '取消',
	'modal.confirm': '确定',
	'modal.close': '关闭',

	// ===== 设置 =====
	'settings.title': '设置',
	'settings.defaultLayout': '默认布局',
	'settings.defaultLayoutDesc': '新建思维导图时使用的默认布局',
	'settings.defaultTheme': '默认主题',
	'settings.defaultThemeDesc': '新建思维导图时使用的默认主题',
	'settings.autoSave': '自动保存',
	'settings.autoSaveDesc': '编辑思维导图时自动保存到文件',
	'settings.enableDrag': '启用节点拖拽',
	'settings.enableDragDesc': '允许拖拽节点改变层级和顺序',
	'settings.performanceMode': '性能模式',
	'settings.performanceModeDesc':
		'节点数超过阈值时自动启用虚拟渲染，仅渲染可视区域内的节点',
	'settings.performanceThreshold': '性能模式阈值',
	'settings.performanceThresholdDesc': '节点数达到该数量时自动启用性能模式',
	'settings.exportScale': '导出图片倍率',
	'settings.exportScaleDesc':
		'导出 PNG 时的分辨率倍率（越高越清晰，文件越大）',
	'settings.codeBlockLayout': '代码块默认布局',
	'settings.codeBlockLayoutDesc': 'Markdown 代码块中渲染思维导图的默认布局',
	'settings.language': '语言',
	'settings.languageDesc': '界面语言',
	'settings.langZh': '中文',
	'settings.langEn': 'English',

	// ===== 布局选项 =====
	'layout.logical': '逻辑结构图',
	'layout.mindMap': '思维导图',
	'layout.organization': '组织结构图',
	'layout.catalog': '目录组织图',
	'layout.timeline': '时间轴',
	'layout.fishbone': '鱼骨图',

	// ===== 主题选项 =====
	'theme.default': '默认（跟随 Obsidian 主题）',
	'theme.forceLight': '强制亮色',
	'theme.forceDark': '强制暗色',

	// ===== 节点样式预设颜色 =====
	'color.default': '默认',
	'color.blue': '蓝色',
	'color.green': '绿色',
	'color.yellow': '黄色',
	'color.red': '红色',
	'color.purple': '紫色',
	'color.orange': '橙色',
	'color.pink': '粉色',
	'color.cyan': '青色',
	'color.gray': '灰色',

	// ===== 搜索栏按钮提示 =====
	'search.prev': '上一个 (shift+enter)',
	'search.next': '下一个 (enter)',
	'search.close': '关闭 (esc)',

	// ===== 导出 =====
	'export.pngFailed': '导出 PNG 失败：',

	// ===== 图片保存 =====
	'attachment.tooLarge': '图片过大（{size}MB），最大支持 {max}MB',
	'attachment.saveFailed': '保存图片失败: ',
	'attachment.dragData': '拖拽数据: ',
	'attachment.chooseImage': '请选择图片文件',

	// ===== 节点图片 =====
	'nodeImage.alt': '节点图片',

	// ===== 默认内容（新建思维导图） =====
	'default.centerTopic': '中心主题',
	'default.shortcutHint': '快捷键很好用！',
	'default.tabHint': 'Tab：新建子节点',
	'default.enterHint': 'Enter：新建同级节点',
	'default.fileNamePrefix': '思维导图',
	'default.secondLevel': '主题',
	'default.belowSecondLevel': '子主题',
} as const;

/** 英文字典（key → English） */
const EN: Record<TranslationKey, string> = {
	// ===== 命令 =====
	'command.createMindMap': 'Create new mind map',
	'command.createInCurrentFolder': 'Create mind map in current folder',
	'command.searchNodes': 'Search nodes',
	'command.fitCanvas': 'Fit to canvas',
	'command.arrange': 'Arrange mind map',
	'command.exportPng': 'Export as PNG',
	'command.created': 'Mind map created',
	'command.createFailed': 'Failed to create mind map: ',
	'command.openAsMindMap': 'Open as mind map',
	'command.openAsMarkdown': 'Open as Markdown',
	'command.backToMarkdown': 'Edit as Markdown',
	'rename.titleConflict': 'A file with that name already exists; cannot rename by central topic',
	'rename.titleFailed': 'Failed to rename file by central topic',

	// ===== 工具栏 =====
	'toolbar.addChild': 'Add child node (Tab)',
	'toolbar.addSibling': 'Add sibling node (Enter)',
	'toolbar.deleteNode': 'Delete node (Del)',
	'toolbar.undo': 'Undo (Ctrl+Z)',
	'toolbar.redo': 'Redo (Ctrl+Y)',
	'toolbar.backToMarkdown': 'Edit as Markdown',
	'toolbar.undoShort': 'Undo',
	'toolbar.redoShort': 'Redo',
	'toolbar.arrange': 'Auto Arrange',
	'toolbar.search': 'Search nodes (Ctrl+F)',
	'toolbar.searchPlaceholder': 'Search nodes...',
	'toolbar.insertLink': 'Insert Link',
	'toolbar.insertImage': 'Insert Image',
	'toolbar.layout': 'Layout: ',
	'toolbar.zoomIn': 'Zoom In',
	'toolbar.zoomOut': 'Zoom Out',
	'toolbar.exportPng': 'Export PNG',

	// ===== 右键菜单 =====
	'menu.editText': 'Edit Text',
	'menu.addChild': 'Add Child Node',
	'menu.addSibling': 'Add Sibling Node',
	'menu.copyNode': 'Copy Node',
	'menu.pasteAsChild': 'Paste as Child',
	'menu.addLink': 'Add Link',
	'menu.addImage': 'Add Image',
	'menu.viewImageFullscreen': 'View Image Fullscreen',
	'menu.removeImage': 'Remove Image',
	'menu.deleteNode': 'Delete Node',
	'menu.pasteNode': 'Paste Node',

	// ===== 通用提示/通知 =====
	'common.mindMap': 'Mind Map',
	'common.notLoaded': 'Mind map not loaded yet',
	'common.arrangeDone': 'Arrange done',
	'common.arrangeFailed': 'Arrange failed',
	'common.noMatch': 'No match',
	'common.nodes': 'node(s)',
	'common.selectNodeFirst': 'Please select a node first',
	'common.rootCannotDelete': 'Root node cannot be deleted',
	'common.clipboardEmpty': 'Clipboard is empty',
	'common.nodeCopied': 'Node copied',
	'common.selectNodeBeforePasteImage': 'Please select a node before pasting an image',
	'common.savingClipboardImage': 'Saving clipboard image...',
	'common.imageSavedTo': 'Image saved to: ',
	'common.pasteImageFailed': 'Paste image failed: ',
	'common.imageSetOnNode': 'Image set on node: ',
	'common.linkedTo': 'Linked node to ',
	'common.nodeCreatedAndLinked': 'Node created and linked to ',
	'common.cannotPreview': 'Cannot preview this file type in Obsidian',
	'common.cannotOpen': 'Cannot open this file type',
	'common.unknownError': 'Unknown error',

	// ===== 拖拽/导入 =====
	'common.selectNodeBeforeDropImage': 'Please select a node before dropping images',
	'common.selectNodeBeforeDrop': 'Please select a node before dropping an image',
	'common.onlySupportedFiles':
		'Only Markdown notes or image files are supported',
	'common.onlyImagesSupported': 'Mind map Markdown supports images only (audio/video/PDF cannot be written back)',
	'common.noImagesDropped': 'No image files detected',
	'common.importing': 'Importing',
	'common.imagesToVault': 'image(s) to the vault...',
	'common.imported': 'Imported',
	'common.imagesStored': 'image(s) (stored per "Attachment folder" setting)',

	// ===== 弹窗 - 链接 =====
	'modal.link.title': 'Set Node Link',
	'modal.link.placeholder': 'Enter a URL or search notes/attachments…',
	'modal.link.clear': 'Clear Link',
	'link.noMatchNote':
		'No matching note found; the input text will be used as the link',

	// ===== 弹窗 - 图片 =====
	'modal.image.title': 'Set Node Image',
	'modal.image.urlLabel': 'Image URL or Obsidian internal path: ',
	'modal.image.hint':
		'Enter URL, or choose a local image below (auto-saved to attachments)',
	'modal.image.chooseLocal': 'Choose Local Image',
	'modal.image.paste': 'Paste Image',
	'modal.image.localHint':
		'Choose a local image, auto-saved to attachment folder',
	'modal.image.loadFailed': 'Image load failed',
	'modal.image.none': 'No image',
	'modal.image.saving': 'Saving to attachment folder...',
	'modal.image.saved': 'Saved: ',
	'modal.image.saveFailed': 'Save failed',
	'modal.image.noClipboardImage': 'No image in clipboard',
	'modal.image.clipboardError': 'Cannot access clipboard',
	'modal.image.clear': 'Clear Image',
	'modal.image.internalPath': 'Vault path: ',
	'modal.image.address': 'Image address: ',

	// ===== 弹窗 - 命名 =====
	'modal.name.folder': 'Folder: ',
	'modal.name.placeholder': 'Enter name...',

	// ===== 通用按钮 =====
	'modal.cancel': 'Cancel',
	'modal.confirm': 'OK',
	'modal.close': 'Close',

	// ===== 设置 =====
	'settings.title': 'Settings',
	'settings.defaultLayout': 'Default Layout',
	'settings.defaultLayoutDesc': 'Default layout when creating a new mind map',
	'settings.defaultTheme': 'Default Theme',
	'settings.defaultThemeDesc': 'Default theme when creating a new mind map',
	'settings.autoSave': 'Auto Save',
	'settings.autoSaveDesc': 'Automatically save the mind map to file while editing',
	'settings.enableDrag': 'Enable Node Drag',
	'settings.enableDragDesc':
		'Allow dragging nodes to change hierarchy and order',
	'settings.performanceMode': 'Performance Mode',
	'settings.performanceModeDesc':
		'Automatically enable virtual rendering when node count exceeds threshold',
	'settings.performanceThreshold': 'Performance Mode Threshold',
	'settings.performanceThresholdDesc':
		'Enable performance mode when node count reaches this value',
	'settings.exportScale': 'Export Image Scale',
	'settings.exportScaleDesc':
		'Resolution scale when exporting PNG (higher = sharper, larger file)',
	'settings.codeBlockLayout': 'Code Block Layout',
	'settings.codeBlockLayoutDesc':
		'Default layout for mind map rendered in Markdown code blocks',
	'settings.language': 'Language',
	'settings.languageDesc': 'UI language',
	'settings.langZh': '中文',
	'settings.langEn': 'English',

	// ===== 布局选项 =====
	'layout.logical': 'Logical Structure',
	'layout.mindMap': 'Mind Map',
	'layout.organization': 'Organization Chart',
	'layout.catalog': 'Catalog Organization',
	'layout.timeline': 'Timeline',
	'layout.fishbone': 'Fishbone',

	// ===== 主题选项 =====
	'theme.default': 'Default (follow Obsidian theme)',
	'theme.forceLight': 'Force Light',
	'theme.forceDark': 'Force Dark',

	// ===== 节点样式预设颜色 =====
	'color.default': 'Default',
	'color.blue': 'Blue',
	'color.green': 'Green',
	'color.yellow': 'Yellow',
	'color.red': 'Red',
	'color.purple': 'Purple',
	'color.orange': 'Orange',
	'color.pink': 'Pink',
	'color.cyan': 'Cyan',
	'color.gray': 'Gray',

	// ===== 搜索栏按钮提示 =====
	'search.prev': 'Previous (shift+enter)',
	'search.next': 'Next (enter)',
	'search.close': 'Close (esc)',

	// ===== 导出 =====
	'export.pngFailed': 'Export PNG failed: ',

	// ===== 图片保存 =====
	'attachment.tooLarge':
		'Image too large ({size}MB); maximum is {max}MB',
	'attachment.saveFailed': 'Failed to save image: ',
	'attachment.dragData': 'Drag data: ',
	'attachment.chooseImage': 'Choose an image file',

	// ===== 节点图片 =====
	'nodeImage.alt': 'Node Image',

	// ===== 默认内容（新建思维导图） =====
	'default.centerTopic': 'Central Topic',
	'default.shortcutHint': 'Shortcuts work great!',
	'default.tabHint': 'Tab: New child node',
	'default.enterHint': 'Enter: New sibling node',
	'default.fileNamePrefix': 'MindMap',
	'default.secondLevel': 'Topic',
	'default.belowSecondLevel': 'Subtopic',
};

/** 合法翻译 key（由 ZH 字典的 key 集合派生，编译期类型检查） */
export type TranslationKey = keyof typeof ZH;

/**
 * 根据语言取文案。
 * @param lang 当前语言（zh/en）
 * @param key 翻译 key（必须是 ZH 字典中定义的 key）
 */
export function t(lang: Language, key: TranslationKey): string {
	if (lang === 'en') {
		return EN[key] ?? ZH[key];
	}
	return ZH[key];
}
