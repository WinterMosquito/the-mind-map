/**
 * Vault 同步服务：响应库内文件的 rename/delete/create 事件。
 *
 * Markdown 渲染层下插件不再持有 .mindmap 附件索引/反链等跨文件状态，
 * 本服务仅剩两类职责：
 * 1. 打开视图的引用更新 —— 文件重命名/删除后，通知每个打开的导图视图
 *    同步树内图片/[[链接]] 引用（links-tree 预检零拷贝）；
 * 2. 文件查找缓存失效 —— 库文件列表变化时清除共享的 path→file 缓存
 *    （图片解析/回写用，images-path 惰性重建）。
 *
 * 用结构接口 MindMapViewLike 替代直接 import MindMapView，避免与
 * view.ts（其运行时 import main.ts）形成循环依赖。
 */
import { App, Plugin, TAbstractFile, TFile } from 'obsidian';
import { VIEW_TYPE } from './constants';
import { invalidateFileLookupIndexCache } from './images';

/** MindMapView 的最小结构接口：仅暴露本服务需要的成员 */
interface MindMapViewLike {
	mindMap: unknown;
	updateReferencesOnRename(file: TFile, oldPath: string): void;
	updateReferencesOnDelete(file: TFile): void;
}

export class VaultSyncService {
	constructor(private app: App) {}

	/** 注册全部 vault 事件处理器（在插件 onload 中调用一次） */
	attach(plugin: Plugin): void {
		plugin.registerEvent(
			this.app.vault.on('rename', (file, oldPath) =>
				this.handleRename(file, oldPath),
			),
		);
		plugin.registerEvent(
			this.app.vault.on('delete', (file) => this.handleDelete(file)),
		);
		plugin.registerEvent(
			this.app.vault.on('create', (file) => this.handleCreate(file)),
		);
	}

	/** 文件重命名：失效查找缓存 + 同步打开导图的引用 */
	private handleRename(file: TAbstractFile, oldPath: string): void {
		invalidateFileLookupIndexCache();
		if (!(file instanceof TFile)) {
			return;
		}
		this.forEachOpenMindMapView((view) => {
			if (view.mindMap) {
				view.updateReferencesOnRename(file, oldPath);
			}
		});
	}

	/** 文件删除：失效查找缓存 + 同步打开导图的引用 */
	private handleDelete(file: TAbstractFile): void {
		invalidateFileLookupIndexCache();
		if (!(file instanceof TFile)) {
			return;
		}
		this.forEachOpenMindMapView((view) => {
			if (view.mindMap) {
				view.updateReferencesOnDelete(file);
			}
		});
	}

	/** 文件创建：失效查找缓存（新文件的路径/资源地址立即可查） */
	private handleCreate(file: TAbstractFile): void {
		invalidateFileLookupIndexCache();
		void file;
	}

	/** 遍历所有打开的思维导图视图 */
	private forEachOpenMindMapView(
		callback: (view: MindMapViewLike) => void,
	): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
			// getLeavesOfType(VIEW_TYPE) 已保证 leaf.view 是 MindMapView 实例，
			// 经 unknown 中转做结构断言（避免与 view.ts 的运行时循环依赖）。
			callback(leaf.view as unknown as MindMapViewLike);
		});
	}
}
