import { $, $$, i18n } from "./dom";
import { state, updateState, Comment, INITIAL_VISIBLE_REPLIES, LOAD_MORE_BATCH, globals } from "./types";
import { toNum, normalizeComment } from "./utils";
import { api } from "./api";
import {
    renderComment,
    revealCommentsList,
    refreshLayout,
    focusNewComment
} from "./ui";
import {
    findThreadAnchor,
    getDirectChildren,
    updateMoreRepliesControl,
    getParentMeta,
    setSubtreeVisibility,
    collapseInitialReplies
} from "./thread-logic";

/**
 * Loads the main list of comments for the content.
 */
export async function loadComments(contentId: string | null, from = 0) {
    if (!contentId) return;

    const section = $(".comments");
    const list = $(".comments > ul");
    if (!list) return;

    const params = {
        content_id: contentId,
        sort: section?.dataset.sort || "threads_recent",
        size: Math.max(1, Math.min(100, toNum(section?.dataset.size, 50))),
        from,
        replies_limit: Math.max(1, toNum(section?.dataset.initialRepliesLimit, INITIAL_VISIBLE_REPLIES)),
        hot_size: from === 0 ? Math.max(0, Math.min(5, toNum(section?.dataset.hotSize, 0))) : 0,
        hot_min_likes: Math.max(1, toNum(section?.dataset.hotMinLikes, 1)),
        site_id: toNum(section?.dataset.siteId),
    };

    if (from === 0) {
        updateState({ commentsLoadedFrom: 0, commentsTotalCount: 0, allCommentsLoaded: false });
    }

    try {
        const json = await api.get("/list", params);
        if (!json?.success || !json.items) {
            revealCommentsList();
            return;
        }

        updateState({ isCurrentUserAdmin: Boolean(json.is_admin) });
        if (json.current_user_id > 0) {
            updateState({ currentMinionUserId: toNum(json.current_user_id) });
        }
        updateState({ commentsTotalCount: json.total || 0 });

        const items = [...(from === 0 && Array.isArray(json.hot_items) ? json.hot_items : []), ...json.items];
        updateState({ commentsLoadedFrom: state.commentsLoadedFrom + json.items.length });

        if (state.commentsLoadedFrom >= state.commentsTotalCount) {
            updateState({ allCommentsLoaded: true });
        }

        if (from === 0) list.innerHTML = "";

        if (items.length === 0 && from === 0) {
            list.innerHTML = `<li><p>${i18n.noComments}</p></li>`;
        } else {
            items.forEach((raw: any) => {
                const c = normalizeComment(raw);
                if (c.Status === "deleted" && c.ReplyCount <= 0) return;
                list.appendChild(renderComment(c));
            });
            collapseInitialReplies();
        }

        refreshLayout();
        revealCommentsList();
    } catch (e) {
        console.error("Failed to load comments", e);
        revealCommentsList();
    }
}

/**
 * Loads the next page of main comments (Infinite Scroll).
 */
export async function loadMoreComments(contentId: string | null) {
    if (!contentId || state.isLoadingMoreComments || state.allCommentsLoaded) return;
    updateState({ isLoadingMoreComments: true });
    $(".comments-loading")?.classList.remove("hidden");

    try {
        await loadComments(contentId, state.commentsLoadedFrom);
    } finally {
        updateState({ isLoadingMoreComments: false });
        $(".comments-loading")?.classList.add("hidden");
    }
}

/**
 * Recomputes the number of loaded responses based on the DOM structure.
 */
export function recomputeLoadedReplyCounts() {
    const all = $$(".comment-container[data-comment-id]");

    all.forEach(parent => {
        const parentId = toNum(parent.dataset.commentId);
        const parentIndent = toNum(parent.dataset.indent);
        if (parentId <= 0) return;
        const parentLi = parent.closest("li") as HTMLElement | null;
        if (!parentLi) return;

        let descendantsCount = 0;
        let directCount = 0;
        let cursor = parentLi.nextElementSibling as HTMLElement | null;
        while (cursor) {
            const c = $(".comment-container", cursor);
            if (!c) { cursor = cursor.nextElementSibling as HTMLElement | null; continue; }
            const indent = toNum(c.dataset.indent);
            if (indent <= parentIndent) break;
            descendantsCount++;
            if (toNum(c.dataset.parentId) === parentId) directCount++;
            cursor = cursor.nextElementSibling as HTMLElement | null;
        }

        parent.dataset.replyCount = String(descendantsCount);
        parent.dataset.directReplyTotal = String(directCount);
        parent.dataset.nextCursor = "";
    });
}

/**
 * Inserts a batch of comments into the DOM at the correct positions.
 */
export function insertCommentsBatch(items: any[]) {
    const list = $(".comments > ul");
    if (!list || !Array.isArray(items) || items.length === 0) return;

    const containers = $$(".comment-container[data-comment-id]");
    const known = new Set(containers.map(el => el.dataset.commentId).filter(Boolean));

    const valid = items
        .map((raw: any) => normalizeComment(raw))
        .filter((c: Comment) => c.CommentId > 0 && !known.has(String(c.CommentId)) && !(c.Status === "deleted" && c.ReplyCount <= 0));

    if (valid.length === 0) return;

    valid.sort((a, b) => {
        if (a.Path && b.Path) return a.Path.localeCompare(b.Path);
        if (a.Indent !== b.Indent) return a.Indent - b.Indent;
        return a.CommentId - b.CommentId;
    });

    let anchor: HTMLElement | null = null;
    valid.forEach(c => {
        if (known.has(String(c.CommentId))) return;
        const el = renderComment(c);
        const parentLi = c.ParentId > 0 ? $(`.comment-container[data-comment-id="${c.ParentId}"]`)?.closest("li") : null;
        if (parentLi) {
            const threadAnchor = findThreadAnchor(parentLi, $(".comment-container", parentLi)!);
            threadAnchor.insertAdjacentElement("afterend", el);
        } else {
            anchor ? anchor.insertAdjacentElement("afterend", el) : list.appendChild(el);
            anchor = el;
        }
        known.add(String(c.CommentId));
    });

    recomputeLoadedReplyCounts();

    if (state.isHashContextMode) {
        $$(".comment-more-item").forEach(el => el.remove());
    } else {
        collapseInitialReplies();
    }
    refreshLayout();
}

/**
 * Reveals the path to a comment (all parents).
 */
export function revealCommentPath(commentId: number) {
    let currentId = commentId;
    let guard = 0;
    while (currentId > 0 && guard < 100) {
        const container = $(`.comment-container[data-comment-id="${currentId}"]`) as HTMLElement | null;
        if (!container) break;
        const li = container.closest("li") as HTMLElement | null;
        if (li) setSubtreeVisibility(li, true);
        currentId = toNum(container.dataset.parentId);
        guard++;
    }
}

/**
 * Loads the thread context if there's a comment hash in the URL.
 */
export async function hydrateFromHashContext(contentId: string | null) {
    if (!contentId) return;
    const m = (window.location.hash || "").match(/^#comment-(\d+)$/);
    const targetId = m ? toNum(m[1]) : 0;
    if (!targetId) return;

    const existing = $(`#comment-${targetId}`)?.closest("li") as HTMLElement | null;
    if (existing) {
        focusNewComment(existing, false);
        return;
    }

    const section = $(".comments");
    const params: Record<string, any> = {
        content_id: contentId,
        comment_id: targetId,
        limit: 100,
        site_id: toNum(section?.dataset.siteId) || undefined,
        lang: (globals.lang || "").trim() || undefined,
    };

    try {
        const json = await api.get("/context", params);
        if (!json?.success || !Array.isArray(json.items) || json.items.length === 0) return;

        const list = $(".comments > ul");
        if (list) list.innerHTML = "";

        updateState({ isHashContextMode: true });
        insertCommentsBatch(json.items);
        revealCommentsList();
        revealCommentPath(targetId);

        const target = $(`#comment-${targetId}`)?.closest("li") as HTMLElement | null;
        if (target) focusNewComment(target, false);
    } catch (err) {
        console.error("Failed to hydrate comments context by hash", err);
    }
}

/**
 * Loads additional replies for a specific comment.
 */
export async function loadMoreReplies(parentId: number, parentLi: HTMLElement, parentContainer: HTMLElement, moreBtn: HTMLElement) {
    const section = $(".comments");
    const contentId = toNum(section?.dataset.contentId);
    if (!contentId) return;

    const { directReplyTotal } = getParentMeta(parentContainer);
    const directChildren = getDirectChildren(parentLi, parentContainer);
    const hiddenDirect = directChildren.filter(li => li.style.display === "none");

    let cursor = parentContainer.dataset.nextCursor || "";
    let size = Math.max(1, toNum(section?.dataset.threadDirectSize, LOAD_MORE_BATCH));
    let repliesLimit = Math.max(1, toNum(parentContainer.dataset.threadRepliesLimitCurrent, toNum(section?.dataset.threadRepliesLimit, INITIAL_VISIBLE_REPLIES)));

    if (!cursor && directReplyTotal >= 0 && directChildren.length >= directReplyTotal) {
        cursor = "";
        size = Math.max(1, Math.min(50, directReplyTotal));
        repliesLimit = Math.min(50, repliesLimit + toNum(section?.dataset.threadRepliesLimit, INITIAL_VISIBLE_REPLIES));
        parentContainer.dataset.threadRepliesLimitCurrent = String(repliesLimit);
    }

    if ((moreBtn as HTMLButtonElement).disabled !== undefined) (moreBtn as HTMLButtonElement).disabled = true;
    const prevText = moreBtn.textContent || "";
    moreBtn.textContent = i18n.loading;

    try {
        const json = await api.get("/thread", {
            content_id: contentId,
            parent_id: parentId,
            cursor,
            size,
            sort: section?.dataset.sort || "threads_recent",
            replies_limit: repliesLimit,
            site_id: toNum(section?.dataset.siteId)
        });

        let focusTarget: HTMLElement | null = null;

        if (json.total >= 0) parentContainer.dataset.directReplyTotal = String(json.total);
        if (json.next_cursor !== undefined) parentContainer.dataset.nextCursor = json.next_cursor || "";

        if (hiddenDirect.length > 0) {
            const reveal = Math.min(LOAD_MORE_BATCH, hiddenDirect.length);
            for (let i = 0; i < reveal; i++) {
                setSubtreeVisibility(hiddenDirect[i], true);
                focusTarget = hiddenDirect[i];
            }
        }

        if (json.success && Array.isArray(json.items) && json.items.length > 0) {
            const containers = $$(".comment-container[data-comment-id]");
            const known = new Set(containers.map(el => el.dataset.commentId).filter(Boolean));
            const anchor = findThreadAnchor(parentLi, parentContainer);
            let lastAnchor: HTMLElement = anchor;

            json.items.forEach((raw: any) => {
                const c = normalizeComment(raw, { ParentId: parentId });
                if (c.CommentId > 0 && known.has(String(c.CommentId))) return;
                if (c.Status === "deleted" && c.ReplyCount <= 0) return;
                const el = renderComment(c);
                lastAnchor.insertAdjacentElement("afterend", el);
                lastAnchor = el;
                focusTarget = el;
                if (c.CommentId > 0) known.add(String(c.CommentId));
            });
        }

        updateMoreRepliesControl(parentLi, parentContainer);
        refreshLayout();
        if (focusTarget) focusNewComment(focusTarget, false);
    } catch (err) {
        console.error("Failed to load more replies", err);
        moreBtn.textContent = prevText;
    } finally {
        if ((moreBtn as HTMLButtonElement).disabled !== undefined) (moreBtn as HTMLButtonElement).disabled = false;
        if (moreBtn.textContent === i18n.loading) updateMoreRepliesControl(parentLi, parentContainer);
    }
}
