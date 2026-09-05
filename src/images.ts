/**
 * 图片处理统一出口（barrel）：
 * 实现按主题拆分到 images-path.ts（地址解析/索引/树处理）与
 * images-save.ts（图片保存/查找），本文件仅汇总 re-export，
 * 调用方 import './images' 不受拆分影响。
 */
export {
	isExternalUrl,
	resolveImagePath,
	serializeImagePath,
	walkResolveImagePaths,
	walkSerializeImagePaths,
	buildFileLookupIndex,
	getCachedFileLookupIndex,
	invalidateFileLookupIndexCache,
	lookupIndexedFile,
	createSetNodeImageOptions,
	normalizeImageSizes,
	probeImageNaturalSize,
	computeAspectImageSize,
	createAspectSetNodeImageOptions,
	walkCorrectImageSizesByAspect,
} from './images-path';
export {
	sanitizeFileName,
	saveImageToVault,
	findAttachmentFile,
} from './images-save';
