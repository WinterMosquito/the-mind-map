/**
 * 搜索栏子系统：构建搜索栏 DOM 与搜索/上下跳转/计数逻辑。
 * 从 view.ts 抽取，逻辑以接收 MindMapView 实例的模块函数组织；
 * view.ts 中的同名方法保留为外观（委托到这里的实现），调用方无需改动。
 */
import { setIcon } from 'obsidian';
import { t } from './i18n';
import type { MindMapView } from './view';

/** 构建搜索栏（DOM 与事件监听） */
export function buildSearchBar(view: MindMapView): void {
	const searchBar = view.searchBarEl;
	if (!searchBar) {
		return;
	}
	searchBar.addClass('mindmap-search-bar-hidden');
	view.searchInput = searchBar.createEl('input', {
		cls: 'mindmap-search-input',
		attr: {
			type: 'text',
			placeholder: t(view.lang, 'toolbar.searchPlaceholder'),
			spellcheck: 'false',
		},
	});
	view.searchCountEl = searchBar.createSpan('mindmap-search-count');
	const prevButton = searchBar.createEl('button', {
		cls: 'mindmap-search-btn',
		attr: { title: t(view.lang, 'search.prev') },
	});
	setIcon(prevButton, 'chevron-up');
	prevButton.onclick = () => searchPrev(view);
	const nextButton = searchBar.createEl('button', {
		cls: 'mindmap-search-btn',
		attr: { title: t(view.lang, 'search.next') },
	});
	setIcon(nextButton, 'chevron-down');
	nextButton.onclick = () => searchNext(view);
	const closeButton = searchBar.createEl('button', {
		cls: 'mindmap-search-btn',
		attr: { title: t(view.lang, 'search.close') },
	});
	setIcon(closeButton, 'x');
	closeButton.onclick = () => closeSearchBar(view);
	view.viewEvents.onDom(view.searchInput, 'input', () => doSearch(view));
	view.viewEvents.onDom(view.searchInput, 'keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			if (event.shiftKey) {
				searchPrev(view);
			} else {
				searchNext(view);
			}
		} else if (event.key === 'Escape') {
			closeSearchBar(view);
		}
	});
}

/** 打开搜索栏并聚焦输入框 */
export function openSearchBar(view: MindMapView): void {
	if (!view.searchBarEl || !view.mindMap) {
		return;
	}
	view.searchBarEl.removeClass('mindmap-search-bar-hidden');
	window.setTimeout(() => view.searchInput?.focus(), 50);
}

/** 关闭搜索栏并结束引擎搜索 */
export function closeSearchBar(view: MindMapView): void {
	if (!view.searchBarEl) {
		return;
	}
	view.searchBarEl.addClass('mindmap-search-bar-hidden');
	view.mindMap?.search?.endSearch();
	if (view.searchInput) {
		view.searchInput.value = '';
	}
	view.searchCountEl?.setText('');
	view.canvasEl?.focus();
}

/** 执行搜索 */
export function doSearch(view: MindMapView): void {
	if (!view.mindMap?.search || !view.searchInput) {
		return;
	}
	const keyword = view.searchInput.value.trim();
	if (!keyword) {
		view.mindMap.search.endSearch();
		view.searchCountEl?.setText('');
		return;
	}
	view.mindMap.search.search(keyword, () => updateSearchCount(view));
}

/** 跳到下一个匹配 */
export function searchNext(view: MindMapView): void {
	view.mindMap?.search?.searchNext(() => updateSearchCount(view));
}

/** 跳到上一个匹配（循环） */
export function searchPrev(view: MindMapView): void {
	if (!view.mindMap?.search) {
		return;
	}
	const matches = view.mindMap.search.matchNodeList;
	if (!matches || matches.length === 0) {
		return;
	}
	let index = view.mindMap.search.currentIndex - 1;
	if (index < 0) {
		index = matches.length - 1;
	}
	view.mindMap.search.jump(index, () => updateSearchCount(view));
}

/** 更新匹配计数显示 */
export function updateSearchCount(view: MindMapView): void {
	if (!view.searchCountEl || !view.mindMap?.search) {
		return;
	}
	const matches = view.mindMap.search.matchNodeList;
	const current = view.mindMap.search.currentIndex;
	if (!matches || matches.length === 0) {
		view.searchCountEl.setText(t(view.lang, 'common.noMatch'));
		view.searchCountEl.addClass('mindmap-search-no-result');
		return;
	}
	view.searchCountEl.removeClass('mindmap-search-no-result');
	view.searchCountEl.setText(`${current + 1}/${matches.length}`);
}
