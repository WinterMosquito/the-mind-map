/**
 * 事件绑定器：统一管理 DOM 事件与引擎事件的注册与清理。
 *
 * 背景：原先 MindMapView 上散落着 10+ 个 boundHandle* 字段，每个监听器
 * 都在 setup*() 中赋值、在 destroyMindMapInstance() 中手动 removeEventListener/off。
 * 新增监听器时必须同步在两处维护，极易遗漏导致内存泄漏或重复触发。
 *
 * 本类把「注册即记录、销毁即清理」收敛到一处：
 * - onDom() 注册 DOM 事件并记录 (target, type, listener, options)
 * - onEngine() 注册引擎事件并记录 (emitter, event, listener)
 * - destroy() 一次性移除全部已注册事件
 *
 * 用法（视图层两个生命周期作用域）：
 * - engineEvents：随引擎实例重建而注册/清理（在 initMindMap 注册、destroyMindMapInstance 清理）
 * - viewEvents：随视图生命周期注册/清理（在 onOpen 注册、onClose 清理）
 */

/** 支持的事件目标类型（DOM 元素 / window 等实现 addEventListener 的对象） */
export interface EventTargetLike {
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): void;
	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): void;
}

/** 引擎事件接口（simple-mind-map 的 MindMap 提供 on/off） */
export interface EngineEventEmitter {
	on(event: string, listener: (...args: unknown[]) => void): void;
	off(event: string, listener: (...args: unknown[]) => void): void;
}

interface DomEntry {
	target: EventTargetLike;
	type: string;
	listener: EventListenerOrEventListenerObject;
	options?: boolean | AddEventListenerOptions;
}

interface EngineEntry {
	emitter: EngineEventEmitter;
	event: string;
	listener: (...args: unknown[]) => void;
}

export class EventBinder {
	private domEntries: DomEntry[] = [];
	private engineEntries: EngineEntry[] = [];

	/**
	 * 注册 DOM 事件并自动记录，destroy() 时移除。
	 * 类型参数 K 约束为目标元素支持的事件名，保证回调参数类型正确。
	 *
	 * 注意：泛型监听器 (event: HTMLElementEventMap[K]) => void 在 strict 模式下
	 * 无法直接赋给 EventListenerOrEventListenerObject（参数逆变），但浏览器运行时
	 * 始终传入具体事件子类型，故经 unknown 中转断言为等价类型，安全。
	 */
	onDom<K extends keyof HTMLElementEventMap>(
		target: EventTargetLike,
		type: K,
		listener: (event: HTMLElementEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): void {
		const handler = listener as unknown as EventListenerOrEventListenerObject;
		target.addEventListener(type, handler, options);
		this.domEntries.push({
			target,
			type,
			listener: handler,
			options,
		});
	}

	/**
	 * 注册引擎事件并自动记录，destroy() 时 off。
	 * 引擎实例在每次 initMindMap 时重建，故调用方应在注册后把该 emitter
	 * 与当前 mindMap 绑定；destroy 会对记录的 emitter 调用 off。
	 */
	onEngine(
		emitter: EngineEventEmitter,
		event: string,
		listener: (...args: unknown[]) => void,
	): void {
		emitter.on(event, listener);
		this.engineEntries.push({ emitter, event, listener });
	}

	/** 清理所有已注册的 DOM 与引擎事件（幂等：重复调用安全） */
	destroy(): void {
		for (const entry of this.domEntries) {
			try {
				entry.target.removeEventListener(
					entry.type,
					entry.listener,
					entry.options,
				);
			} catch {
				// 目标已被移除等异常情况忽略
			}
		}
		this.domEntries = [];
		for (const entry of this.engineEntries) {
			try {
				entry.emitter.off(entry.event, entry.listener);
			} catch {
				// 引擎已销毁等异常情况忽略
			}
		}
		this.engineEntries = [];
	}
}
