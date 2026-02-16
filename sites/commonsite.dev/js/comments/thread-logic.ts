import { toNum } from "./utils";
import { INITIAL_VISIBLE_REPLIES, MAX_SIBLINGS } from "./types";
import { $ as select, $$ as selectAll } from "./dom";

/**
 * Retrieves the metadata of a comment's parent container.
 */
export function getParentMeta(container: HTMLElement) {
    return {
        parentId: toNum(container.dataset.commentId),
        parentIndent: toNum(container.dataset.indent),
        totalReplies: toNum(container.dataset.replyCount),
        directReplyTotal: container.dataset.directReplyTotal === undefined
            ? toNum(container.dataset.replyCount, -1)
            : toNum(container.dataset.directReplyTotal, -1),
    };
}

/**
 * Finds the insertion point (anchor) in the DOM for a child comment or "load more" button.
 */
export function findThreadAnchor(parentLi: HTMLElement, parentContainer: HTMLElement): HTMLElement {
    const parentIndent = toNum(parentContainer.dataset.indent);
    let anchor: HTMLElement = parentLi;
    let cursor = parentLi.nextElementSibling as HTMLElement | null;

    while (cursor) {
        const c = select(".comment-container", cursor);
        if (!c) {
            if (cursor.classList.contains("comment-more-item")) {
                const moreParentId = toNum(cursor.dataset.parentId);
                const moreParent = moreParentId > 0 ? select(`.comment-container[data-comment-id="${moreParentId}"]`) : null;
                const moreIndent = moreParent ? toNum(moreParent.dataset.indent) + 1 : parentIndent + 1;
                if (moreIndent <= parentIndent) break;
                anchor = cursor;
                cursor = cursor.nextElementSibling as HTMLElement | null;
                continue;
            }
            cursor = cursor.nextElementSibling as HTMLElement | null;
            continue;
        }
        const indent = toNum(c.dataset.indent);
        if (indent <= parentIndent) break;
        anchor = cursor;
        cursor = cursor.nextElementSibling as HTMLElement | null;
    }
    return anchor;
}

/**
 * Returns a list of direct children for the specified parent.
 */
export function getDirectChildren(parentLi: HTMLElement, parentContainer: HTMLElement): HTMLElement[] {
    const { parentId, parentIndent } = getParentMeta(parentContainer);
    const children: HTMLElement[] = [];
    let cursor = parentLi.nextElementSibling as HTMLElement | null;

    while (cursor) {
        const c = select(".comment-container", cursor);
        if (!c) { cursor = cursor.nextElementSibling as HTMLElement | null; continue; }
        const indent = toNum(c.dataset.indent);
        if (indent <= parentIndent) break;
        if (toNum(c.dataset.parentId) === parentId) children.push(cursor);
        cursor = cursor.nextElementSibling as HTMLElement | null;
    }
    return children;
}

/**
 * Manages the visibility of an entire comment subtree.
 */
export function setSubtreeVisibility(commentLi: HTMLElement, visible: boolean) {
    const container = select(".comment-container", commentLi);
    if (!container) return;
    const rootIndent = toNum(container.dataset.indent);
    let cursor: HTMLElement | null = commentLi;

    while (cursor) {
        const c = select(".comment-container", cursor);
        if (!c) {
            const li = cursor;
            if (li.classList.contains("comment-more-item")) {
                const moreParentId = toNum(li.dataset.parentId);
                const moreParent = moreParentId > 0 ? select(`.comment-container[data-comment-id="${moreParentId}"]`) : null;
                const moreIndent = moreParent ? toNum(moreParent.dataset.indent) + 1 : rootIndent + 1;
                if (cursor !== commentLi && moreIndent <= rootIndent) break;
                li.style.display = visible ? "" : "none";
                cursor = cursor.nextElementSibling as HTMLElement | null;
                continue;
            }
            cursor = cursor.nextElementSibling as HTMLElement | null;
            continue;
        }
        const indent = toNum(c.dataset.indent);
        if (cursor !== commentLi && indent <= rootIndent) break;
        cursor.style.display = visible ? "" : "none";
        cursor = cursor.nextElementSibling as HTMLElement | null;
    }
}

/**
 * Creates or returns an existing "Load more replies" list item.
 */
export function getOrCreateMoreRepliesLi(parentLi: HTMLElement, parentContainer: HTMLElement): HTMLElement {
    const { parentId } = getParentMeta(parentContainer);
    const parentIndent = toNum(parentContainer.dataset.indent);
    const anchor = findThreadAnchor(parentLi, parentContainer);
    const existing = select(`.comment-more-item[data-parent-id="${parentId}"]`);

    if (existing) {
        if (existing.previousElementSibling !== anchor) anchor.insertAdjacentElement("afterend", existing);
        return existing;
    }

    const moreLi = document.createElement("li");
    moreLi.className = "comment-more-item";
    moreLi.dataset.parentId = String(parentId);
    moreLi.style.marginInlineStart = `calc(${parentIndent + 1} * var(--comment-indent-step))`;
    moreLi.innerHTML = `<button type="button" class="comment-more-btn" data-parent-id="${parentId}"></button>`;
    anchor.insertAdjacentElement("afterend", moreLi);
    return moreLi;
}

/**
 * Updates the state and text of the "Load more replies" control.
 */
export function updateMoreRepliesControl(parentLi: HTMLElement, parentContainer: HTMLElement) {
    const { parentId, directReplyTotal } = getParentMeta(parentContainer);
    const allDirect = getDirectChildren(parentLi, parentContainer);
    const hiddenDirect = allDirect.filter(li => li.style.display === "none");
    const visibleDirectCount = allDirect.length - hiddenDirect.length;

    const hasNextCursor = Boolean(parentContainer.dataset.nextCursor);
    const hasMoreInAPI = directReplyTotal > visibleDirectCount;

    if (!hasNextCursor && hiddenDirect.length <= 0 && !hasMoreInAPI) {
        select(`.comment-more-item[data-parent-id="${parentId}"]`)?.remove();
        return;
    }

    let remainingDirect = 0;
    if (hiddenDirect.length > 0) {
        remainingDirect = hiddenDirect.length;
    } else if (directReplyTotal >= 0) {
        remainingDirect = Math.max(0, directReplyTotal - visibleDirectCount);
    } else if (hasNextCursor) {
        remainingDirect = 1;
    }

    if (remainingDirect <= 0 || visibleDirectCount >= MAX_SIBLINGS) {
        select(`.comment-more-item[data-parent-id="${parentId}"]`)?.remove();
        return;
    }

    const moreLi = getOrCreateMoreRepliesLi(parentLi, parentContainer);
    moreLi.dataset.remaining = String(remainingDirect);
    moreLi.dataset.hiddenDirect = String(hiddenDirect.length);

    const btn = select(".comment-more-btn", moreLi);
    if (btn) {
        btn.innerHTML = `<svg viewBox="0 0 24 24" class="icon-more-replies"><path fill="currentColor" d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg><span>${remainingDirect}</span>`;
    }
}

/**
 * Collapses threads during initial load once the limit is reached.
 */
export function collapseInitialReplies() {
    selectAll(".comments > ul > li").forEach(li => {
        const container = select(".comment-container", li);
        if (!container) return;
        const children = getDirectChildren(li, container);
        const total = toNum(container.dataset.replyCount);
        if (children.length <= INITIAL_VISIBLE_REPLIES && total <= INITIAL_VISIBLE_REPLIES) return;
        for (let i = INITIAL_VISIBLE_REPLIES; i < children.length; i++) {
            setSubtreeVisibility(children[i], false);
        }
        updateMoreRepliesControl(li, container);
    });
}
