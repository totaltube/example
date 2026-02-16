import { Comment, MAX_INDENT, state } from "./types";
import { $, $$, i18n } from "./dom";
import { toNum, getCurrentUserId, formatDate } from "./utils";

/**
 * Cache the template for faster rendering.
 */
const template = $("#comment-template-js") as HTMLTemplateElement | null;

/**
 * Smoothly reveals the comments list.
 */
export function revealCommentsList() {
    const list = $(".comments > ul");
    if (list) list.classList.add("comments-list-visible");
}

/**
 * Returns the text for a deleted comment based on the status reason.
 */
export const getDeletedCommentText = (c: Comment): string => {
    if (c.Status !== "deleted") return c.Text;
    const reason = (c.Text || "").trim().toLowerCase();
    if (reason === "deleted_by_user") return i18n.deletedByUser;
    if (reason === "moderated") return i18n.moderated;
    return i18n.deleted;
};

/**
 * Sets the color scheme for the comment score.
 */
export function setScoreTone(scoreEl: HTMLElement | null, score: number) {
    if (!scoreEl) return;
    scoreEl.classList.remove("score-positive", "score-negative", "score-neutral");
    if (score > 0) scoreEl.classList.add("score-positive");
    else if (score < 0) scoreEl.classList.add("score-negative");
    else scoreEl.classList.add("score-neutral");
}

/**
 * Main function for rendering a comment's HTML.
 */
export function renderComment(c: Comment): HTMLElement {
    const frag = template?.content.cloneNode(true) as DocumentFragment;
    const li = frag?.querySelector("li") as HTMLElement;
    const container = li?.querySelector(".comment-container") as HTMLElement;
    if (!li || !container) throw new Error("Template not found");

    const id = Math.max(0, c.CommentId) || `tmp-${Date.now()}-${Math.random() * 1000 | 0}`;
    const isDeleted = c.Status === "deleted";
    const currentUserId = getCurrentUserId();
    const isOwner = currentUserId > 0 && c.UserId > 0 && currentUserId === c.UserId;

    Object.assign(container.dataset, {
        commentId: String(c.CommentId || 0),
        parentId: String(c.ParentId || 0),
        replyCount: String(c.ReplyCount || 0),
        indent: String(c.Indent || 0),
        status: c.Status || "approved",
        userId: String(c.UserId || 0)
    });
    container.id = `comment-${id}`;
    container.style.setProperty("--comment-indent", String(c.Indent || 0));
    container.classList.toggle("is-reply", c.ParentId > 0);
    container.classList.toggle("own-comment", isOwner);
    container.classList.toggle("comment-deleted", isDeleted);

    const avatar = $(".avatar", container);
    if (avatar) {
        avatar.style.display = isDeleted ? "none" : "";
        const img = $("img", avatar) as HTMLImageElement;
        if (!isDeleted && c.Avatar && img) { img.src = c.Avatar; img.alt = c.Username; }
    }

    const username = $(".comment-username", container);
    const date = $(".comment-date", container);
    if (username) username.textContent = isDeleted ? "" : c.Username;
    if (date) date.textContent = isDeleted ? "" : formatDate(c.Created);

    const context = $(".comment-context", container);
    if (context && c.ParentId > 0 && !isDeleted) {
        const replyTo = c.ReplyToUsername || $(`.comment-container[data-comment-id="${c.ParentId}"] .comment-username`)?.textContent?.trim() || "";
        if (replyTo) container.dataset.replyToUsername = replyTo;
        context.innerHTML = `<a class="comment-parent-link" href="#comment-${c.ParentId}" title="${i18n.replyingTo} ${replyTo}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 19h-7a2 2 0 0 1-2-2V5"/><path d="m15 9-4-4-4 4"/></svg>
        </a>`;
        context.classList.remove("hidden");
    } else if (context) {
        context.textContent = "";
        context.classList.add("hidden");
    }

    const text = $(".comment-text", container);
    if (text) text.textContent = isDeleted ? getDeletedCommentText(c) : c.Text;

    const actions = $(".comment-actions", container);
    const replyBox = $(".comment-reply", container);

    if (isDeleted) {
        actions?.classList.add("hidden");
        replyBox?.classList.add("hidden");
    } else {
        const permalink = $(".comment-permalink", container) as HTMLAnchorElement;
        if (permalink) permalink.href = `#comment-${id}`;

        $(".like-button", container)?.classList.toggle("active", c.IsLiked);
        $(".dislike-button", container)?.classList.toggle("active", c.IsDisliked);

        if (isOwner) {
            $$(".like-button, .dislike-button", container).forEach(b => {
                const btn = b as HTMLButtonElement;
                btn.classList.add("is-disabled");
                btn.disabled = true;
            });
        }

        const score = $(".score-count", container);
        if (score) {
            const scoreValue = c.Likes - c.Dislikes;
            score.textContent = String(scoreValue);
            setScoreTone(score, scoreValue);
        }

        const replyBtn = $(".reply-button", container);
        const isCrossSite = toNum($(`.comments`)?.dataset.siteId) > 0 && c.SiteId > 0 && c.SiteId !== toNum($(`.comments`)?.dataset.siteId);
        if (replyBtn && (c.Indent >= MAX_INDENT || isCrossSite)) {
            replyBtn.classList.add("hidden");
            replyBox?.classList.add("hidden");
        } else if (replyBtn) {
            replyBtn.innerHTML = `<span>${i18n.reply}</span>`;
        }

        $(".delete-button", container)?.classList.toggle("hidden", !(isOwner || state.isCurrentUserAdmin));
        $(".comment-menu-container", container)?.classList.remove("hidden");
    }

    return li;
}

/**
 * Scrolls the page to the comment and sets focus.
 */
export function focusNewComment(li: HTMLElement, shouldUpdateHash: boolean = false) {
    const container = $(".comment-container", li);
    if (!container?.id) return;
    const hash = `#${container.id}`;
    if (shouldUpdateHash && window.location.hash !== hash) window.history.replaceState({}, document.title, hash);
    container.setAttribute("tabindex", "-1");
    container.scrollIntoView({ behavior: "smooth", block: "center" });
    try { container.focus({ preventScroll: true }); } catch { container.focus(); }
}


/**
 * Retrieves the current reaction state (like/dislike) from the DOM.
 */
export function getReactionState(container: HTMLElement) {
    const likeBtn = $(".like-button, .like-button-alt", container);
    const dislikeBtn = $(".dislike-button, .dislike-button-alt", container);
    const scoreEl = $(".score-count", container);
    return {
        likeBtn, dislikeBtn, scoreEl,
        isLiked: likeBtn?.classList.contains("active") ?? false,
        isDisliked: dislikeBtn?.classList.contains("active") ?? false,
        score: toNum(scoreEl?.textContent),
    };
}

/**
 * Applies the reaction state to the DOM.
 */
export function setReactionState(container: HTMLElement, state: { isLiked: boolean; isDisliked: boolean; score: number }) {
    $(".like-button, .like-button-alt", container)?.classList.toggle("active", state.isLiked);
    $(".dislike-button, .dislike-button-alt", container)?.classList.toggle("active", state.isDisliked);
    const score = $(".score-count", container);
    if (score) {
        score.textContent = String(state.score);
        setScoreTone(score, state.score);
    }
}

/**
 * Redraws the thread connection lines.
 */
export function updateThreadLines() {
    $$(".comment-container.is-reply").forEach(child => {
        const parentId = child.dataset.parentId;
        const parent = $(`.comment-container[data-comment-id="${parentId}"]`);
        if (!parent) return;

        const childRect = child.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        const childCenter = childRect.top + childRect.height / 2;
        const parentCenter = parentRect.top + parentRect.height / 2;
        const dist = childCenter - parentCenter;

        if (dist > 0) {
            child.style.setProperty("--thread-height", `${dist}px`);
        }
    });
}

/**
 * Refreshes the layout: updates z-indices and redraws thread lines.
 */
export function refreshLayout() {
    const allComments = $$(".comment-container[data-comment-id]");
    const baseZIndex = 10000;
    allComments.forEach((container, i) => {
        container.style.zIndex = String(baseZIndex - i);
    });
    requestAnimationFrame(updateThreadLines);
}

/**
 * Shows the copy link dialog below the button.
 */
export function showCopyLinkDialog(container: HTMLElement, url: string) {
    $$(".copy-link-dialog").forEach(el => el.remove());

    const dialog = document.createElement("div");
    dialog.className = "copy-link-dialog";
    dialog.innerHTML = `
        <div class="copy-link-input-wrapper">
            <input type="text" class="copy-link-input" value="${url}" readonly>
            <button class="copy-link-btn">Copy</button>
        </div>
    `;
    container.appendChild(dialog);

    const input = $(".copy-link-input", dialog) as HTMLInputElement;
    const btn = $(".copy-link-btn", dialog) as HTMLButtonElement;

    input.focus();
    input.select();

    btn.onclick = () => {
        input.select();
        document.execCommand("copy");
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => { dialog.remove(); }, 1500);
    };

    input.onclick = () => input.select();
}
