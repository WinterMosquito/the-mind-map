/**
 * obsidian 最小 mock：仅供 scratch/md-roundtrip 在 Node 下回归解析/序列化。
 * 真实运行由 Obsidian 提供完整实现；这里只需要模块在 bundle 时可加载、
 * 类存在（instanceof 等在函数体内使用，不会被顶层求值触发）。
 */
export class App {}
export class TFile {}
export class TFolder {}
export class Notice {
	constructor(_message?: string, _timeout?: number) {}
}
export function normalizePath(p: unknown): string {
	return String(p).replace(/\\/g, '/');
}
