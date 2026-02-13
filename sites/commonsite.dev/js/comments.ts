import { getAuthToken as getStoredAuthToken, login } from "./auth"

type Globals = {
    lang: string
    captcha_key: string
    comments_endpoint?: string
}

document.addEventListener("DOMContentLoaded", () => {
    const globals = (window as any).globals as Globals
    const endpoint = globals.comments_endpoint || "/api-comments"
    const commentsSection = document.querySelector(".comments") as HTMLElement | null
    const i18nReplyingTo = commentsSection?.getAttribute("data-i18n-replying-to") || "Replying to"
    const i18nNoComments = commentsSection?.getAttribute("data-i18n-no-comments") || "No comments yet."
    const i18nMoreReplies = commentsSection?.getAttribute("data-i18n-more-replies") || "More {count} replies"
    const i18nLoading = commentsSection?.getAttribute("data-i18n-loading") || "Loading..."
    const INITIAL_VISIBLE_REPLIES = 2
    const LOAD_MORE_BATCH = 5

    // Helper to find parent comment container
    function getCommentContainer(el: Element): Element | null {
        return el.closest(".comment-container")
    }

    function getEventTargetElement(target: EventTarget | null): Element | null {
        if (!target) return null
        if (target instanceof Element) return target
        if (target instanceof Node) return target.parentElement
        return null
    }

    function clearAuthToken() {
        try {
            localStorage.removeItem("comment_token")
            sessionStorage.removeItem("comment_token")
            document.cookie = "comment_token=; path=/; max-age=0"
        } catch {
        }
    }

    function isExpiredTokenError(message: string): boolean {
        const lower = (message || "").toLowerCase()
        return lower.includes("token is expired") || lower.includes("invalid user token")
    }

    let loginWaitPromise: Promise<string | null> | null = null

    function waitForTokenAfterLogin(previousToken: string | null): Promise<string | null> {
        if (loginWaitPromise) return loginWaitPromise
        login()
        loginWaitPromise = new Promise((resolve) => {
            const startedAt = Date.now()
            const timeoutMs = 120000
            const interval = window.setInterval(() => {
                const token = getStoredAuthToken()
                if (token && token !== previousToken) {
                    window.clearInterval(interval)
                    loginWaitPromise = null
                    resolve(token)
                    return
                }
                if (Date.now() - startedAt > timeoutMs) {
                    window.clearInterval(interval)
                    loginWaitPromise = null
                    resolve(null)
                }
            }, 400)
        })
        return loginWaitPromise
    }

    async function requestJsonWithAuthRetry(url: string, init: RequestInit): Promise<any> {
        const makeRequest = async (requestInit: RequestInit) => {
            const response = await fetch(url, requestInit)
            let json: any = null
            try {
                json = await response.json()
            } catch {
            }
            return { response, json }
        }

        const { response, json } = await makeRequest(init)
        if (response.ok && (!json || json.success !== false)) {
            return json
        }

        const errorMessage = String(json?.error || json?.value || `HTTP ${response.status}`)
        if (!isExpiredTokenError(errorMessage)) {
            throw new Error(errorMessage)
        }

        const previousToken = getStoredAuthToken()
        clearAuthToken()
        const refreshedToken = await waitForTokenAfterLogin(previousToken)
        if (!refreshedToken) {
            throw new Error("Login required")
        }

        const retryHeaders = new Headers(init.headers || {})
        retryHeaders.set("X-Comment-Token", refreshedToken)
        if (!retryHeaders.has("Content-Type")) {
            retryHeaders.set("Content-Type", "application/json")
        }

        const retried = await makeRequest({ ...init, headers: retryHeaders })
        if (retried.response.ok && (!retried.json || retried.json.success !== false)) {
            return retried.json
        }

        throw new Error(String(retried.json?.error || retried.json?.value || `HTTP ${retried.response.status}`))
    }

    const template = document.getElementById("comment-template-js") as HTMLTemplateElement

    interface Comment {
        CommentId: number
        ParentId: number
        Indent: number
        ReplyCount: number
        Avatar: string
        Username: string
        ReplyToUsername: string
        Text: string
        Likes: number
        Dislikes: number
        IsLiked: boolean
        IsDisliked: boolean
    }

    type RawComment = Record<string, any>

    function toNumber(value: any, fallback = 0): number {
        const num = Number(value)
        return Number.isFinite(num) ? num : fallback
    }

    function normalizeComment(raw: RawComment, fallback: Partial<Comment> = {}): Comment {
        const parentId = toNumber(raw?.ParentId ?? raw?.parent_id ?? fallback.ParentId, 0)
        return {
            CommentId: toNumber(raw?.CommentId ?? raw?.comment_id ?? fallback.CommentId, 0),
            ParentId: parentId,
            Indent: toNumber(raw?.Indent ?? raw?.indent ?? fallback.Indent, parentId > 0 ? 1 : 0),
            ReplyCount: toNumber(raw?.ReplyCount ?? raw?.reply_count ?? fallback.ReplyCount, 0),
            Avatar: String(raw?.Avatar ?? raw?.avatar ?? fallback.Avatar ?? ""),
            Username: String(raw?.Username ?? raw?.username ?? fallback.Username ?? ""),
            ReplyToUsername: String(raw?.ReplyToUsername ?? raw?.reply_to_username ?? fallback.ReplyToUsername ?? ""),
            Text: String(raw?.Text ?? raw?.text ?? fallback.Text ?? ""),
            Likes: toNumber(raw?.Likes ?? raw?.likes ?? fallback.Likes, 0),
            Dislikes: toNumber(raw?.Dislikes ?? raw?.dislikes ?? fallback.Dislikes, 0),
            IsLiked: Boolean(raw?.IsLiked ?? raw?.is_liked ?? fallback.IsLiked),
            IsDisliked: Boolean(raw?.IsDisliked ?? raw?.is_disliked ?? fallback.IsDisliked),
        }
    }

    function resolveReplyUsername(comment: Comment): string {
        if (comment.ReplyToUsername) return comment.ReplyToUsername
        const parentContainer = document.getElementById(`comment-${comment.ParentId}`)
        if (!parentContainer) return ""

        const parentName = parentContainer.querySelector(".comment-username")
        return parentName?.textContent?.trim() || ""
    }

    function renderComment(comment: Comment): Element {
        const clone = template.content.cloneNode(true) as DocumentFragment
        const li = clone.querySelector("li") as HTMLElement
        const container = li.querySelector(".comment-container") as HTMLElement

        const commentId = Math.max(0, toNumber(comment.CommentId, 0))
        const domCommentId = commentId > 0 ? commentId.toString() : `tmp-${Date.now()}-${Math.floor(Math.random() * 1000)}`
        container.setAttribute("data-comment-id", commentId.toString())
        container.id = `comment-${domCommentId}`
        container.setAttribute("data-parent-id", (comment.ParentId || 0).toString())
        container.setAttribute("data-reply-count", toNumber(comment.ReplyCount, 0).toString())
        container.setAttribute("data-indent", comment.Indent.toString())
        container.style.setProperty("--comment-indent", comment.Indent.toString())
        container.classList.toggle("is-reply", comment.ParentId > 0)

        const avatarImg = container.querySelector(".avatar img") as HTMLImageElement
        if (comment.Avatar) {
            avatarImg.src = comment.Avatar
            avatarImg.alt = comment.Username
        } // else placeholder is already there

        container.querySelector(".comment-username")!.textContent = comment.Username
        const contextEl = container.querySelector(".comment-context") as HTMLElement
        if (comment.ParentId > 0) {
            const replyToName = resolveReplyUsername(comment)
            if (replyToName) {
                container.setAttribute("data-reply-to-username", replyToName)
            }
            contextEl.textContent = ""
            contextEl.append(document.createTextNode(`${i18nReplyingTo} `))
            const parentLink = document.createElement("a")
            parentLink.className = "comment-parent-link"
            parentLink.href = `#comment-${comment.ParentId}`
            parentLink.textContent = replyToName ? `@${replyToName}` : `#${comment.ParentId}`
            contextEl.append(parentLink)
            contextEl.classList.remove("hidden")
        } else {
            contextEl.textContent = ""
            contextEl.classList.add("hidden")
        }

        container.querySelector(".comment-text")!.textContent = comment.Text
        const permalink = container.querySelector(".comment-permalink") as HTMLAnchorElement
        permalink.href = `#comment-${domCommentId}`
        permalink.textContent = "#"

        const likeBtn = container.querySelector(".like-button") as HTMLElement
        if (comment.IsLiked) likeBtn.classList.add("active")

        const scoreCount = container.querySelector(".score-count") as HTMLElement
        if (scoreCount) {
            scoreCount.textContent = (comment.Likes - comment.Dislikes).toString()
        }

        const dislikeBtn = container.querySelector(".dislike-button") as HTMLElement
        if (comment.IsDisliked) dislikeBtn.classList.add("active")

        return li
    }

    function findThreadInsertAnchor(parentLi: Element, parentContainer: Element): Element {
        const parentIndent = Number(parentContainer.getAttribute("data-indent") || "0")

        let anchor = parentLi
        let cursor = parentLi.nextElementSibling

        while (cursor) {
            const cursorContainer = cursor.querySelector(".comment-container")
            if (!cursorContainer) {
                // Keep service rows (like "more replies") inside subtree traversal.
                if ((cursor as HTMLElement).classList.contains("comment-more-item")) {
                    const moreParentId = toNumber((cursor as HTMLElement).getAttribute("data-parent-id"), 0)
                    const moreParent = moreParentId > 0
                        ? document.querySelector(`.comment-container[data-comment-id="${moreParentId}"]`) as HTMLElement | null
                        : null
                    const moreIndent = moreParent ? toNumber(moreParent.getAttribute("data-indent"), 0) + 1 : parentIndent + 1
                    if (moreIndent <= parentIndent) break
                    anchor = cursor
                    cursor = cursor.nextElementSibling
                    continue
                }
                cursor = cursor.nextElementSibling
                continue
            }

            const cursorIndent = Number(cursorContainer.getAttribute("data-indent") || "0")
            if (cursorIndent <= parentIndent) break

            anchor = cursor
            cursor = cursor.nextElementSibling
        }

        return anchor
    }

    function getParentMeta(parentContainer: Element) {
        const parentId = toNumber(parentContainer.getAttribute("data-comment-id"), 0)
        const parentIndent = toNumber(parentContainer.getAttribute("data-indent"), 0)
        const totalReplies = toNumber(parentContainer.getAttribute("data-reply-count"), 0) // descendants total
        const directReplyTotalRaw = parentContainer.getAttribute("data-direct-reply-total")
        const directReplyTotal = directReplyTotalRaw === null ? -1 : toNumber(directReplyTotalRaw, -1)
        return { parentId, parentIndent, totalReplies, directReplyTotal }
    }

    function getDirectChildLis(parentLi: Element, parentContainer: Element): HTMLElement[] {
        const { parentId, parentIndent } = getParentMeta(parentContainer)
        const children: HTMLElement[] = []
        let cursor = parentLi.nextElementSibling as HTMLElement | null
        while (cursor) {
            const c = cursor.querySelector(".comment-container") as HTMLElement | null
            if (!c) {
                cursor = cursor.nextElementSibling as HTMLElement | null
                continue
            }
            const indent = toNumber(c.getAttribute("data-indent"), 0)
            if (indent <= parentIndent) break
            const cParentId = toNumber(c.getAttribute("data-parent-id"), 0)
            if (cParentId === parentId) {
                children.push(cursor)
            }
            cursor = cursor.nextElementSibling as HTMLElement | null
        }
        return children
    }

    function setSubtreeVisibility(commentLi: Element, visible: boolean) {
        const commentContainer = commentLi.querySelector(".comment-container") as HTMLElement | null
        if (!commentContainer) return
        const rootIndent = toNumber(commentContainer.getAttribute("data-indent"), 0)
        let cursor: Element | null = commentLi
        while (cursor) {
            const c = cursor.querySelector(".comment-container") as HTMLElement | null
            if (!c) {
                const li = cursor as HTMLElement
                if (li.classList.contains("comment-more-item")) {
                    const moreParentId = toNumber(li.getAttribute("data-parent-id"), 0)
                    const moreParent = moreParentId > 0
                        ? document.querySelector(`.comment-container[data-comment-id="${moreParentId}"]`) as HTMLElement | null
                        : null
                    const moreIndent = moreParent ? toNumber(moreParent.getAttribute("data-indent"), 0) + 1 : rootIndent + 1
                    if (cursor !== commentLi && moreIndent <= rootIndent) break
                    li.style.display = visible ? "" : "none"
                    cursor = cursor.nextElementSibling
                    continue
                }
                cursor = cursor.nextElementSibling
                continue
            }
            const indent = toNumber(c.getAttribute("data-indent"), 0)
            if (cursor !== commentLi && indent <= rootIndent) break
                ; (cursor as HTMLElement).style.display = visible ? "" : "none"
            cursor = cursor.nextElementSibling
        }
    }

    function getOrCreateMoreRepliesLi(parentLi: Element, parentContainer: Element): HTMLLIElement {
        const { parentId } = getParentMeta(parentContainer)
        const parentIndent = toNumber(parentContainer.getAttribute("data-indent"), 0)
        const anchor = findThreadInsertAnchor(parentLi, parentContainer)
        const existingAny = document.querySelector(`.comment-more-item[data-parent-id="${parentId}"]`) as HTMLLIElement | null
        if (existingAny) {
            // Keep control at the correct place (after current subtree end).
            if (existingAny.previousElementSibling !== anchor) {
                anchor.insertAdjacentElement("afterend", existingAny)
            }
            return existingAny
        }

        const moreLi = document.createElement("li")
        moreLi.className = "comment-more-item"
        moreLi.setAttribute("data-parent-id", parentId.toString())
        moreLi.style.marginInlineStart = `calc(${parentIndent + 1} * var(--comment-indent-step))`

        const button = document.createElement("button")
        button.type = "button"
        button.className = "comment-more-btn"
        button.setAttribute("data-parent-id", parentId.toString())
        moreLi.appendChild(button)

        anchor.insertAdjacentElement("afterend", moreLi)
        return moreLi
    }

    function updateMoreRepliesControl(parentLi: Element, parentContainer: Element) {
        const { parentId, totalReplies, parentIndent, directReplyTotal } = getParentMeta(parentContainer)
        const allDirectChildren = getDirectChildLis(parentLi, parentContainer)
        const visibleDirectChildren = allDirectChildren.filter((li) => (li as HTMLElement).style.display !== "none")
        const hiddenDirectChildren = allDirectChildren.filter((li) => (li as HTMLElement).style.display === "none")
        const visibleDescendants = (() => {
            let count = 0
            let cursor = parentLi.nextElementSibling as HTMLElement | null
            while (cursor) {
                const c = cursor.querySelector(".comment-container") as HTMLElement | null
                if (!c) {
                    cursor = cursor.nextElementSibling as HTMLElement | null
                    continue
                }
                const indent = toNumber(c.getAttribute("data-indent"), 0)
                if (indent <= parentIndent) break
                if ((cursor as HTMLElement).style.display !== "none") {
                    count++
                }
                cursor = cursor.nextElementSibling as HTMLElement | null
            }
            return count
        })()

        if (totalReplies <= 0 && hiddenDirectChildren.length <= 0) {
            const existing = document.querySelector(`.comment-more-item[data-parent-id="${parentId}"]`) as HTMLElement | null
            if (existing) {
                existing.remove()
            }
            return
        }

        let remainingDirect = 0
        if (directReplyTotal >= 0) {
            remainingDirect = Math.max(0, directReplyTotal - visibleDirectChildren.length)
        } else {
            // Before first /thread call, direct total is unknown.
            // If there are hidden direct comments, reveal them first.
            if (hiddenDirectChildren.length > 0) {
                remainingDirect = hiddenDirectChildren.length
            } else if (totalReplies > visibleDescendants) {
                // There are more descendants than currently visible; allow one probing load.
                remainingDirect = 1
            }
        }

        const remainingDescendants = Math.max(0, totalReplies - visibleDescendants)
        if (remainingDirect <= 0 && remainingDescendants <= 0) {
            const existing = document.querySelector(`.comment-more-item[data-parent-id="${parentId}"]`) as HTMLElement | null
            if (existing) {
                existing.remove()
            }
            return
        }

        const moreLi = getOrCreateMoreRepliesLi(parentLi, parentContainer)
        const labelCount = Math.max(remainingDirect, remainingDescendants)
        moreLi.setAttribute("data-remaining", labelCount.toString())
        moreLi.setAttribute("data-hidden-direct", hiddenDirectChildren.length.toString())

        const btn = moreLi.querySelector(".comment-more-btn") as HTMLButtonElement
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" class="icon-more-replies">
                <path fill="currentColor" d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/>
            </svg>
            <span>${labelCount}</span>
        `
    }

    function collapseInitialReplies() {
        const allLis = Array.from(document.querySelectorAll(".comments > ul > li"))
        for (const li of allLis) {
            const parentContainer = li.querySelector(".comment-container") as HTMLElement | null
            if (!parentContainer) continue
            const directChildren = getDirectChildLis(li, parentContainer)
            const totalReplies = toNumber(parentContainer.getAttribute("data-reply-count"), 0)
            if (directChildren.length <= INITIAL_VISIBLE_REPLIES && totalReplies <= INITIAL_VISIBLE_REPLIES) continue

            for (let i = INITIAL_VISIBLE_REPLIES; i < directChildren.length; i++) {
                setSubtreeVisibility(directChildren[i], false)
            }
            updateMoreRepliesControl(li, parentContainer)
        }
    }

    function focusNewComment(commentLi: Element) {
        const commentContainer = commentLi.querySelector(".comment-container") as HTMLElement | null
        if (!commentContainer || !commentContainer.id) return

        const newHash = `#${commentContainer.id}`
        if (window.location.hash !== newHash) {
            window.history.replaceState({}, document.title, newHash)
        }

        commentContainer.setAttribute("tabindex", "-1")
        commentContainer.scrollIntoView({ behavior: "smooth", block: "center" })
        try {
            commentContainer.focus({ preventScroll: true })
        } catch {
            commentContainer.focus()
        }
    }

    function getReactionState(container: Element) {
        const likeBtn = container.querySelector(".like-button, .like-button-alt") as HTMLElement | null
        const dislikeBtn = container.querySelector(".dislike-button, .dislike-button-alt") as HTMLElement | null
        const scoreEl = container.querySelector(".score-count") as HTMLElement | null

        return {
            likeBtn,
            dislikeBtn,
            scoreEl,
            isLiked: !!likeBtn?.classList.contains("active"),
            isDisliked: !!dislikeBtn?.classList.contains("active"),
            score: Number(scoreEl?.textContent || "0") || 0,
        }
    }

    function setReactionState(container: Element, state: { isLiked: boolean; isDisliked: boolean; score: number }) {
        const likeBtn = container.querySelector(".like-button, .like-button-alt") as HTMLElement | null
        const dislikeBtn = container.querySelector(".dislike-button, .dislike-button-alt") as HTMLElement | null
        const scoreEl = container.querySelector(".score-count") as HTMLElement | null

        likeBtn?.classList.toggle("active", state.isLiked)
        dislikeBtn?.classList.toggle("active", state.isDisliked)
        if (scoreEl) scoreEl.textContent = state.score.toString()
    }

    // Lazy load comments
    const commentsList = document.querySelector(".comments > ul");

    if (commentsSection && commentsList) {
        const hasServerRenderedComments = !!commentsList.querySelector(".comment-container")
        const contentId = commentsSection.getAttribute("data-content-id");
        if (hasServerRenderedComments) {
            // Always refresh from API to keep first payload trimmed by replies_limit.
            loadComments(contentId)
        } else if (!hasServerRenderedComments) {
            const observer = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    observer.disconnect();
                    loadComments(contentId);
                }
            });
            observer.observe(commentsSection);
        }
    }

    async function loadComments(contentId: string | null) {
        if (!contentId) return;

        // params from URL or defaults
        // For simplicity, let's grab defaults or query params if any. 
        // But this is usually for the current page content. 
        // We can check if there are URL params for sort/page, but typically standard load is enough.

        const headers: HeadersInit = { "Content-Type": "application/json" }
        const token = getStoredAuthToken()
        const sort = commentsSection?.getAttribute("data-sort") || "threads_recent"
        const size = Math.max(1, Math.min(100, toNumber(commentsSection?.getAttribute("data-size"), 50)))
        const hotSize = Math.max(0, Math.min(5, toNumber(commentsSection?.getAttribute("data-hot-size"), 0)))
        const hotMinLikes = Math.max(1, toNumber(commentsSection?.getAttribute("data-hot-min-likes"), 1))
        const initialRepliesLimit = Math.max(1, toNumber(commentsSection?.getAttribute("data-initial-replies-limit"), INITIAL_VISIBLE_REPLIES))
        if (token) {
            headers["X-Comment-Token"] = token
        }

        try {
            const res = await fetch(
                `${endpoint}/list?content_id=${contentId}&sort=${encodeURIComponent(sort)}&size=${size}&replies_limit=${initialRepliesLimit}&hot_size=${hotSize}&hot_min_likes=${hotMinLikes}`,
                { headers },
            )
            const json = await res.json()
            if (json.success && json.items) {
                commentsList!.innerHTML = ""; // Clear cached comments
                const mergedItems = [
                    ...(Array.isArray(json.hot_items) ? json.hot_items : []),
                    ...(Array.isArray(json.items) ? json.items : []),
                ]
                if (mergedItems.length === 0) {
                    commentsList!.innerHTML = `<li><p>${i18nNoComments}</p></li>`
                } else {
                    for (const raw of mergedItems) {
                        commentsList!.appendChild(renderComment(normalizeComment(raw)))
                    }
                    collapseInitialReplies()
                }
            }
        } catch (e) {
            console.error("Failed to load fresh comments", e);
        }
    }

    async function loadMoreReplies(parentId: number, parentLi: Element, parentContainer: Element, moreBtn: HTMLElement) {
        const contentId = toNumber(commentsSection?.getAttribute("data-content-id"), 0)
        if (!contentId) return
        const sort = commentsSection?.getAttribute("data-sort") || "threads_recent"
        const threadDirectSize = Math.max(1, toNumber(commentsSection?.getAttribute("data-thread-direct-size"), LOAD_MORE_BATCH))
        const threadRepliesLimit = Math.max(1, toNumber(commentsSection?.getAttribute("data-thread-replies-limit"), INITIAL_VISIBLE_REPLIES))
        const { directReplyTotal } = getParentMeta(parentContainer)

        const directChildren = getDirectChildLis(parentLi, parentContainer)
        const hiddenDirect = directChildren.filter((li) => (li as HTMLElement).style.display === "none")
        let from = directChildren.length
        let size = threadDirectSize
        let requestRepliesLimit = Math.max(1, toNumber(parentContainer.getAttribute("data-thread-replies-limit-current"), threadRepliesLimit))

        // Direct replies are fully loaded, but descendants can still be truncated by replies_limit.
        // Re-query current direct window with increased descendants depth to reveal more nested replies.
        if (directReplyTotal >= 0 && from >= directReplyTotal) {
            from = 0
            size = Math.max(1, Math.min(50, directReplyTotal))
            requestRepliesLimit = Math.min(50, requestRepliesLimit + threadRepliesLimit)
            parentContainer.setAttribute("data-thread-replies-limit-current", requestRepliesLimit.toString())
        }

        const headers: HeadersInit = { "Content-Type": "application/json" }
        const token = getStoredAuthToken()
        if (token) {
            headers["X-Comment-Token"] = token
        }

        if ("disabled" in moreBtn) {
            ; (moreBtn as HTMLButtonElement).disabled = true
        }
        const prevText = moreBtn.textContent || ""
        moreBtn.textContent = i18nLoading
        try {
            const json = await requestJsonWithAuthRetry(
                `${endpoint}/thread?content_id=${contentId}&parent_id=${parentId}&from=${from}&size=${size}&sort=${encodeURIComponent(sort)}&replies_limit=${requestRepliesLimit}`,
                { method: "GET", headers },
            )

            const apiTotal = toNumber(json?.total, -1)
            if (apiTotal >= 0) {
                // Backend thread total is direct replies total for this parent.
                parentContainer.setAttribute("data-direct-reply-total", apiTotal.toString())
            }

            // Always reveal a portion of already-loaded hidden direct replies first.
            if (hiddenDirect.length > 0) {
                const revealCount = Math.min(LOAD_MORE_BATCH, hiddenDirect.length)
                for (let i = 0; i < revealCount; i++) {
                    setSubtreeVisibility(hiddenDirect[i], true)
                }
            }

            if (json?.success && Array.isArray(json.items) && json.items.length > 0) {
                const known = new Set(
                    Array.from(document.querySelectorAll(".comment-container[data-comment-id]"))
                        .map((el) => (el as HTMLElement).getAttribute("data-comment-id"))
                        .filter(Boolean),
                )
                const anchor = findThreadInsertAnchor(parentLi, parentContainer)
                let lastAnchor: Element = anchor
                for (const raw of json.items) {
                    const normalized = normalizeComment(raw, { ParentId: parentId })
                    if (normalized.CommentId > 0 && known.has(normalized.CommentId.toString())) {
                        continue
                    }
                    const newEl = renderComment(normalized)
                    lastAnchor.insertAdjacentElement("afterend", newEl)
                    lastAnchor = newEl
                    if (normalized.CommentId > 0) {
                        known.add(normalized.CommentId.toString())
                    }
                }
            }

            updateMoreRepliesControl(parentLi, parentContainer)
        } catch (err) {
            console.error("Failed to load more replies", err)
            moreBtn.textContent = prevText
        } finally {
            if ("disabled" in moreBtn) {
                ; (moreBtn as HTMLButtonElement).disabled = false
            }
            if (moreBtn.textContent === i18nLoading) {
                updateMoreRepliesControl(parentLi, parentContainer)
            }
        }
    }

    // Like / Dislike
    document.body.addEventListener("click", async (e) => {
        const target = getEventTargetElement(e.target)
        if (!target) return
        const btn = target.closest(".like-button, .dislike-button, .like-button-alt, .dislike-button-alt")
        if (!btn) return
        e.preventDefault()

        const container = getCommentContainer(btn)
        // If it's a top-level fake button (template example), ignore or handle if it has data-id
        if (!container) return

        const commentId = container.getAttribute("data-comment-id")
        if (!commentId) return

        const isLike = btn.classList.contains("like-button") || btn.classList.contains("like-button-alt")
        const action = isLike ? "like" : "dislike"
        const prev = getReactionState(container)
        const next = { ...prev }

        if (isLike) {
            if (prev.isLiked) {
                // Repeat click on active like => remove like
                next.isLiked = false
                next.score = prev.score - 1
            } else {
                // Add like; if dislike was active, remove it
                next.isLiked = true
                next.score = prev.score + 1
                if (prev.isDisliked) {
                    next.isDisliked = false
                    next.score = prev.score + 2 // +1 for removing dislike, +1 for adding like
                }
            }
        } else {
            if (prev.isDisliked) {
                // Repeat click on active dislike => remove dislike
                next.isDisliked = false
                next.score = prev.score + 1
            } else {
                // Add dislike; if like was active, remove it
                next.isDisliked = true
                next.score = prev.score - 1
                if (prev.isLiked) {
                    next.isLiked = false
                    next.score = prev.score - 2 // -1 for removing like, -1 for adding dislike
                }
            }
        }

        setReactionState(container, next)

        try {
            const headers: HeadersInit = { "Content-Type": "application/json" }
            const token = getStoredAuthToken()
            if (token) {
                headers["X-Comment-Token"] = token
            }

            await requestJsonWithAuthRetry(`${endpoint}/${commentId}/${action}`, {
                method: "POST",
                headers: headers
            })
        } catch (err) {
            // Revert optimistic update on failure
            setReactionState(container, prev)
            console.error(err)
        }
    })

    document.body.addEventListener("click", async (e) => {
        const target = getEventTargetElement(e.target)
        if (!target) return
        const btn = target.closest(".comment-more-btn") as HTMLButtonElement | null
        const fallbackLink = !btn ? target.closest(".comment-more-item a") as HTMLAnchorElement | null : null
        if (!btn && !fallbackLink) return
        e.preventDefault()

        const moreControl = (btn || fallbackLink) as HTMLElement
        const parentId = toNumber(
            moreControl.getAttribute("data-parent-id")
            || moreControl.closest(".comment-more-item")?.getAttribute("data-parent-id"),
            0,
        )
        if (!parentId) return
        const parentContainer = document.querySelector(`.comment-container[data-comment-id="${parentId}"]`) as HTMLElement | null
        if (!parentContainer) return
        const parentLi = parentContainer.closest("li")
        if (!parentLi) return

        await loadMoreReplies(parentId, parentLi, parentContainer, (btn || fallbackLink) as HTMLElement)
    })

    // Reply Button
    document.body.addEventListener("click", (e) => {
        const target = getEventTargetElement(e.target)
        if (!target) return
        if (!target.matches(".reply-button")) return

        const container = getCommentContainer(target)
        if (!container) return

        const replyBox = container.querySelector(".comment-reply")
        if (replyBox) {
            replyBox.classList.toggle("active")
            if (replyBox.classList.contains("active")) {
                const input = replyBox.querySelector("textarea") as HTMLTextAreaElement
                if (input) input.focus()
            }
        }
    })

    // Send Comment (Top level or Reply)
    document.body.addEventListener("click", async (e) => {
        const target = getEventTargetElement(e.target)
        if (!target) return
        if (!target.matches(".send-comment-button, .submit-btn")) return
        e.preventDefault()

        const isReply = target.classList.contains("send-comment-button")

        let input: HTMLTextAreaElement | null = null
        let contentId = 0
        let replyToId = 0

        if (isReply) {
            const container = getCommentContainer(target)
            if (!container) return
            input = container.querySelector(".comment-reply textarea")
            replyToId = parseInt(container.getAttribute("data-comment-id") || "0")
            // Find content id from global context or a data attribute on the comments section
            const commentsSection = document.querySelector(".comments")
            if (commentsSection) {
                contentId = parseInt(commentsSection.getAttribute("data-content-id") || "0")
            }
        } else {
            // Main form
            const form = target.closest(".comment-form")
            if (!form) return
            input = form.querySelector("textarea")
            const commentsSection = document.querySelector(".comments")
            if (commentsSection) {
                contentId = parseInt(commentsSection.getAttribute("data-content-id") || "0")
            }
        }

        if (!input || !input.value.trim()) return
        if (!contentId) {
            console.error("No content ID found")
            return
        }

        const text = input.value.trim()
        target.setAttribute("disabled", "true")

        try {
            const payload = {
                content_id: contentId,
                text: text,
                reply_to_comment_id: replyToId,
                // captcha?
            }

            const headers: HeadersInit = { "Content-Type": "application/json" }
            const token = getStoredAuthToken()
            if (token) {
                headers["X-Comment-Token"] = token
            }

            const json = await requestJsonWithAuthRetry(`${endpoint}/add`, {
                method: "POST",
                headers: headers,
                body: JSON.stringify(payload)
            })
            console.log("Comment Add Response:", json)
            if (json.success) {
                input.value = ""
                if (json.comment) {
                    const normalized = normalizeComment(json.comment, {
                        ParentId: replyToId,
                    })
                    const newCommentEl = renderComment(normalized)
                    if (replyToId > 0) {
                        // This was a reply
                        // Insert at the end of parent's subtree, not directly after parent.
                        const parentContainer = document.querySelector(`.comment-container[data-comment-id="${replyToId}"]`)
                        if (parentContainer) {
                            const parentLi = parentContainer.closest("li")
                            if (parentLi) {
                                const anchor = findThreadInsertAnchor(parentLi, parentContainer)
                                anchor.insertAdjacentElement("afterend", newCommentEl)
                                const currentReplyCount = toNumber(parentContainer.getAttribute("data-reply-count"), 0)
                                parentContainer.setAttribute("data-reply-count", (currentReplyCount + 1).toString())
                                updateMoreRepliesControl(parentLi, parentContainer)
                                focusNewComment(newCommentEl)
                                // Close reply box
                                const replyBox = parentContainer.querySelector(".comment-reply")
                                if (replyBox) replyBox.classList.remove("active")
                            } else {
                                console.error("Parent LI not found for comment", replyToId)
                            }
                        } else {
                            console.error("Parent container not found for comment", replyToId)
                        }
                    } else {
                        // Top level
                        const commentsList = document.querySelector(".comments > ul")
                        if (commentsList) {
                            // Remove "No comments" placeholder if it exists
                            const firstLi = commentsList.querySelector("li")
                            if (firstLi && firstLi.textContent && firstLi.textContent.trim().length < 50 && !firstLi.querySelector(".comment-container")) {
                                firstLi.remove()
                            }
                            commentsList.insertAdjacentElement("afterbegin", newCommentEl)
                            focusNewComment(newCommentEl)
                        } else {
                            console.error("Comments list not found")
                        }
                    }
                } else {
                    console.error("No comment returned from server")
                }
            } else {
                alert("Error: " + json.error)
            }

        } catch (err) {
            console.error(err)
            if (!(err instanceof Error && err.message === "Login required")) {
                alert("Error sending comment")
            }
        } finally {
            target.removeAttribute("disabled")
        }
    })
})
