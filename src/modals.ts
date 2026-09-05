/**
 * 弹窗模块统一出口（barrel）：
 * 各弹窗实现按类型拆分到 modal-*.ts，本文件仅汇总 re-export，
 * 调用方 import './modals' 不受拆分影响。
 */
export { openLinkEditorModal } from './modal-link';
export { openImageEditorModal } from './modal-image';
export { openNameInputModal } from './modal-name';
