/**
 * 视图状态存储：按文件路径保存布局与视口（缩放/平移）。
 *
 * .mindmap.md 正文必须保持纯 Markdown，布局/视口不写入文件；
 * 状态存插件 data.json（顶层 `viewState` 键，path → 状态），
 * 与 settings 合并写入（保持历史顶层设置格式兼容）。
 *
 * 状态：
 * - layout: 布局类型（logicalStructure/mindMap/...）
 * - view: 引擎 view.getTransformData() 输出（{transform, state}）
 */
export type PathState = Record<string, unknown>;

const VIEW_STATE_KEY = 'viewState';

export class ViewStateStore {
	private map = new Map<string, PathState>();
	private timer: number | null = null;

	/**
	 * @param persist     序列化后的状态写盘回调（由插件注入，合并 data.json）
	 * @param debounceMs  写盘防抖
	 */
	constructor(
		private persist: (state: Record<string, PathState>) => void,
		private debounceMs = 600,
	) {}

	/** 从插件 data.json 载入（顶层 viewState 键） */
	hydrate(data: unknown): void {
		this.map.clear();
		if (data && typeof data === 'object') {
			const raw = (data as Record<string, unknown>)[VIEW_STATE_KEY];
			if (raw && typeof raw === 'object') {
				for (const [path, state] of Object.entries(
					raw as Record<string, unknown>,
				)) {
					if (state && typeof state === 'object') {
						this.map.set(path, state as PathState);
					}
				}
			}
		}
	}

	/** 序列化视图状态（供写盘；也会随 settings 全量保存时一并带上） */
	serialize(): Record<string, PathState> {
		return Object.fromEntries(this.map);
	}

	getLayout(path: string): string | undefined {
		const layout = this.map.get(path)?.layout;
		return typeof layout === 'string' ? layout : undefined;
	}

	setLayout(path: string, layout: string): void {
		this.patch(path, { layout });
	}

	/** 打开方式偏好：'mindmap' | 'markdown'（最后一次主动选择决定） */
	getOpenAs(path: string): 'mindmap' | 'markdown' | undefined {
		const openAs = this.map.get(path)?.openAs;
		return openAs === 'mindmap' || openAs === 'markdown' ? openAs : undefined;
	}

	setOpenAs(path: string, mode: 'mindmap' | 'markdown'): void {
		this.patch(path, { openAs: mode });
	}

	getView(path: string): unknown {
		return this.map.get(path)?.view;
	}

	setView(path: string, view: unknown): void {
		this.patch(path, { view });
	}

	/** 文件重命名后迁移状态键（路径变化） */
	renameKey(oldPath: string, newPath: string): void {
		const state = this.map.get(oldPath);
		if (!state) {
			return;
		}
		this.map.delete(oldPath);
		this.map.set(newPath, state);
		this.schedulePersist();
	}

	/** 文件删除后清理状态键 */
	removeKey(path: string): void {
		if (!this.map.delete(path)) {
			return;
		}
		this.schedulePersist();
	}

	private patch(path: string, partial: PathState): void {
		this.map.set(path, { ...(this.map.get(path) ?? {}), ...partial });
		this.schedulePersist();
	}

	private schedulePersist(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
		}
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.persist(this.serialize());
		}, this.debounceMs);
	}

	/** 立即排空未落盘的变更（插件卸载/视图关闭时调用） */
	flushNow(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
			this.persist(this.serialize());
		}
	}
}
