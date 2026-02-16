/**
 * Entry point for the comments system.
 * This file orchestrates the modules and initializes event listeners.
 */

import { isLoggedIn, login } from "./auth";
import { $, $$, i18n, attr } from "./comments/dom";
import { toNum, getCurrentUserId, normalizeComment } from "./comments/utils";
import { state } from "./comments/types";
import { api } from "./comments/api";
import {
    renderComment,
    focusNewComment,
    getReactionState,
    setReactionState,
    refreshLayout,
    updateThreadLines,
    showCopyLinkDialog
} from "./comments/ui";
import {
    findThreadAnchor,
    updateMoreRepliesControl
} from "./comments/thread-logic";
import {
    loadComments,
    loadMoreComments,
    hydrateFromHashContext,
    loadMoreReplies
} from "./comments/actions";

document.addEventListener("DOMContentLoaded", () => {
    const section = $(".comments");
    const list = $(".comments > ul");
    const sentinel = $(".comments-sentinel");
    if (!section || !list) return;

    const contentId = attr(section, "data-content-id");

    // --- Loading Initialization ---
    // Using IntersectionObserver to start loading only when the comments block becomes visible
    const observer = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) {
            observer.disconnect();
            loadComments(contentId);
            void hydrateFromHashContext(contentId);
        }
    });
    observer.observe(section);

    // Infinite scroll for loading main comments
    if (sentinel) {
        const scrollRoot = $(".comments-wrapper");
        const infiniteObserver = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && !state.isLoadingMoreComments && !state.allCommentsLoaded) {
                loadMoreComments(contentId);
            }
        }, { root: scrollRoot, rootMargin: "200px" });
        infiniteObserver.observe(sentinel);
    }

    // Пересчет линий при ресайзе окна
    window.addEventListener("resize", () => {
        requestAnimationFrame(updateThreadLines);
    });

    // --- Click Event Delegation ---
    document.body.addEventListener("click", async (e) => {
        const target = e.target as HTMLElement;

        // 1. Likes / Dislikes
        const reactionBtn = target.closest(".like-button, .dislike-button, .like-button-alt, .dislike-button-alt") as HTMLElement;
        if (reactionBtn) {
            e.preventDefault();
            if (!isLoggedIn()) {
                login();
                return;
            }
            const container = reactionBtn.closest(".comment-container") as HTMLElement;
            if (!container) return;
            const commentId = container.dataset.commentId;
            if (!commentId) return;

            // Prevent self-voting
            const commentUserId = toNum(container.dataset.userId);
            const currentUserId = getCurrentUserId();
            if (commentUserId > 0 && currentUserId > 0 && commentUserId === currentUserId) return;

            const isLike = reactionBtn.classList.contains("like-button") || reactionBtn.classList.contains("like-button-alt");
            const prev = getReactionState(container);
            const next = { ...prev };

            if (isLike) {
                if (prev.isLiked) { next.isLiked = false; next.score = prev.score - 1; }
                else { next.isLiked = true; next.score = prev.score + 1; if (prev.isDisliked) { next.isDisliked = false; next.score += 1; } }
            } else {
                if (prev.isDisliked) { next.isDisliked = false; next.score = prev.score + 1; }
                else { next.isDisliked = true; next.score = prev.score - 1; if (prev.isLiked) { next.isLiked = false; next.score -= 1; } }
            }

            setReactionState(container, next);
            try {
                await api.post(`/${commentId}/${isLike ? "like" : "dislike"}`);
            } catch (err) {
                setReactionState(container, prev);
                console.error(err);
            }
            return;
        }

        // 2. Loading Replies (Threads)
        const moreBtn = target.closest(".comment-more-btn") as HTMLButtonElement;
        const fallbackLink = !moreBtn ? target.closest(".comment-more-item a") as HTMLAnchorElement : null;
        if (moreBtn || fallbackLink) {
            e.preventDefault();
            const control = (moreBtn || fallbackLink)!;
            const moreItem = control.closest(".comment-more-item") as HTMLElement | null;
            const parentId = toNum(control.dataset.parentId || moreItem?.dataset.parentId);
            if (!parentId) return;
            const parentContainer = $(`.comment-container[data-comment-id="${parentId}"]`);
            if (!parentContainer) return;
            const parentLi = parentContainer.closest("li");
            if (!parentLi) return;
            await loadMoreReplies(parentId, parentLi as HTMLElement, parentContainer, control);
            return;
        }

        // 3. Context Menu Management
        if (target.closest(".comment-menu-btn")) {
            e.preventDefault();
            const btn = target.closest(".comment-menu-btn")!;
            const menuContainer = btn.closest(".comment-menu-container") as HTMLElement;
            const dropdown = $(".comment-menu-dropdown", menuContainer);
            if (dropdown) {
                $$(".comment-menu-dropdown:not(.hidden)").forEach(el => {
                    if (el !== dropdown) el.classList.add("hidden");
                });
                dropdown.classList.toggle("hidden");
            }
            return;
        }

        // 4. Copy Link Dialog
        if (target.closest(".comment-permalink")) {
            e.preventDefault();
            const link = target.closest(".comment-permalink") as HTMLAnchorElement;
            const container = link.closest(".comment-container") as HTMLElement;
            if (!container) return;

            $$(".comment-menu-dropdown:not(.hidden)").forEach(el => el.classList.add("hidden"));

            const commentId = container.dataset.commentId;
            const url = new URL(window.location.href);
            url.hash = `comment-${commentId}`;
            showCopyLinkDialog(container, url.toString());
            return;
        }

        // Close dropdowns when clicking outside
        if (!target.closest(".comment-menu-container")) {
            $$(".comment-menu-dropdown:not(.hidden)").forEach(el => el.classList.add("hidden"));
        }
        if (!target.closest(".copy-link-dialog") && !target.closest(".comment-permalink")) {
            $$(".copy-link-dialog").forEach(el => el.remove());
        }

        // 5. Toggle Reply Form
        if (target.closest(".reply-button")) {
            if (!isLoggedIn()) {
                login();
                return;
            }
            const btn = target.closest(".reply-button")!;
            const container = btn.closest(".comment-container") as HTMLElement;
            if (!container) return;
            const replyBox = $(".comment-reply", container);
            if (replyBox) {
                replyBox.classList.toggle("active");
                if (replyBox.classList.contains("active")) {
                    $("textarea", replyBox)?.focus();
                }
            }
            return;
        }

        // 6. Delete Comment
        if (target.closest(".delete-button")) {
            e.preventDefault();
            if (!isLoggedIn()) {
                login();
                return;
            }
            const btn = target.closest(".delete-button") as HTMLButtonElement;
            const container = btn.closest(".comment-container") as HTMLElement;
            if (!container) return;
            const commentId = container.dataset.commentId;
            if (!commentId || commentId === "0") return;
            if (!confirm(i18n.deleteConfirm)) return;

            btn.disabled = true;
            try {
                await api.post("/delete", { comment_id: commentId });

                const replyCount = toNum(container.dataset.replyCount);
                if (replyCount > 0) {
                    // If there are replies, mark as deleted instead of removing from DOM
                    container.classList.add("comment-deleted");
                    container.dataset.status = "deleted";
                    const text = $(".comment-text", container);
                    if (text) text.textContent = i18n.deleted;
                    const username = $(".comment-username", container);
                    if (username) username.textContent = "";
                    const context = $(".comment-context", container);
                    if (context) { context.textContent = ""; context.classList.add("hidden"); }
                    $(".comment-actions", container)?.classList.add("hidden");
                    $(".comment-reply", container)?.classList.add("hidden");
                    const avatar = $(".avatar img", container) as HTMLImageElement;
                    if (avatar) avatar.src = "/images/avatar_placeholder.png";
                } else {
                    // If no replies, safe to remove element entirely
                    const li = container.closest("li");
                    if (li) {
                        const parentId = toNum(container.dataset.parentId);
                        if (parentId > 0) {
                            const parentContainer = $(`.comment-container[data-comment-id="${parentId}"]`);
                            if (parentContainer) {
                                const count = toNum(parentContainer.dataset.replyCount);
                                if (count > 0) parentContainer.dataset.replyCount = String(count - 1);
                                const parentLi = parentContainer.closest("li");
                                if (parentLi) updateMoreRepliesControl(parentLi as HTMLElement, parentContainer);
                            }
                        }
                        li.remove();
                        refreshLayout();
                    }
                }
            } catch (err) {
                console.error("Failed to delete comment", err);
                alert(String(err instanceof Error ? err.message : "Error deleting comment"));
            } finally {
                btn.disabled = false;
            }
            return;
        }

        // 7. Submit Comment / Reply
        const sendBtn = target.closest(".send-comment-button, .submit-btn");
        if (sendBtn) {
            e.preventDefault();
            const isReply = sendBtn.classList.contains("send-comment-button");

            let input: HTMLTextAreaElement | null = null;
            let currentContentId = 0;
            let replyToId = 0;

            if (isReply) {
                const container = sendBtn.closest(".comment-container") as HTMLElement;
                if (!container) return;
                input = $(".comment-reply textarea", container) as HTMLTextAreaElement;
                replyToId = toNum(container.dataset.commentId);
                currentContentId = toNum($(".comments")?.dataset.contentId);
            } else {
                const form = sendBtn.closest(".comment-form");
                if (!form) return;
                input = $("textarea", form) as HTMLTextAreaElement;
                currentContentId = toNum($(".comments")?.dataset.contentId);
            }

            if (!input?.value.trim() || !currentContentId) return;

            const commentText = input.value.trim();
            sendBtn.setAttribute("disabled", "true");

            try {
                const json = await api.post("/add", {
                    content_id: currentContentId,
                    text: commentText,
                    reply_to_comment_id: replyToId
                });

                if (json.success && json.comment) {
                    input.value = "";
                    const c = normalizeComment(json.comment, { ParentId: replyToId });
                    const el = renderComment(c);

                    if (replyToId > 0) {
                        const parentContainer = $(`.comment-container[data-comment-id="${replyToId}"]`);
                        if (parentContainer) {
                            const parentLi = parentContainer.closest("li") as HTMLElement;
                            if (parentLi) {
                                const anchor = findThreadAnchor(parentLi, parentContainer);
                                anchor.insertAdjacentElement("afterend", el);
                                const count = toNum(parentContainer.dataset.replyCount);
                                parentContainer.dataset.replyCount = String(count + 1);
                                updateMoreRepliesControl(parentLi, parentContainer);
                                focusNewComment(el, true);
                                $(".comment-reply", parentContainer)?.classList.remove("active");
                                refreshLayout();
                            }
                        }
                    } else {
                        const listEl = $(".comments > ul");
                        if (listEl) {
                            const firstLi = $("li", listEl);
                            if (firstLi && !$(".comment-container", firstLi)) firstLi.remove();
                            listEl.insertAdjacentElement("afterbegin", el);
                            focusNewComment(el, true);
                            refreshLayout();
                        }
                    }
                } else {
                    alert("Error: " + json.error);
                }
            } catch (err) {
                console.error(err);
                if (!(err instanceof Error && err.message === "Login required")) {
                    alert("Error sending comment");
                }
            } finally {
                sendBtn.removeAttribute("disabled");
            }
        }
    });
});
