/**
 * 链接模块统一出口（barrel）：
 * 实现按主题拆分到 links-resolve.ts（文件解析）、links-tree.ts（树内引用更新），
 * 本文件仅汇总 re-export，调用方 import './links' 不受拆分影响。
 */
export {
	resolvePathToFile,
	resolveDroppedFile,
	extractDroppedFileNames,
} from './links-resolve';
export {
	removeReferencesOnDelete,
	updateReferencesOnRename,
} from './links-tree';
