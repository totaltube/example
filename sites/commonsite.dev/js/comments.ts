import { getAuthToken as getStoredAuthToken, login } from "./auth"

type Globals = { lang: string; captcha_key: string; comments_endpoint?: string }

const globals = (window as any).globals as Globals
const endpoint = globals.comments_endpoint || "/api-comments"
const INITIAL_VISIBLE_REPLIES = 2
const LOAD_MORE_BATCH = 5
const MAX_INDENT = 9
const MAX_SIBLINGS = 1000

let isCurrentUserAdminFlag = false
let currentMinionUserId = 0
let commentsLoadedFrom = 0
let commentsTotalCount = 0
let isLoadingMoreComments = false
let allCommentsLoaded = false
let loginWaitPromise: Promise<string | null> | null = null
let isHashContextMode = false

const $ = (sel: string, el?: Element) => (el || document).querySelector(sel) as HTMLElement | null
const $$ = (sel: string, el?: Element) => Array.from((el || document).querySelectorAll(sel)) as HTMLElement[]
const attr = (el: Element | null, name: string) => el?.getAttribute(name)
const toNum = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const isExpiredToken = (m: string) => /token is expired|invalid user token/i.test(m)
const parseJwt = (t: string) => {
    try {
        const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
        return JSON.parse(decodeURIComponent(window.atob(b).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')))
    } catch { return null }
}
const getCurrentUserId = () => {
    // Prefer minion user_id from API response (matches comment.UserId)
    if (currentMinionUserId > 0) {
        return currentMinionUserId
    }
    // Fallback to JWT user_id (may not match minion's user_id for same email across providers)
    const t = getStoredAuthToken()
    if (!t) return 0
    const p = parseJwt(t)
    if (!p) return 0
    const userId = toNum(p.user_id ?? p.userId ?? p.sub ?? p.id ?? p.uid)
    console.log("[comments] getCurrentUserId from JWT (fallback):", { user_id: p.user_id, userId: p.userId, sub: p.sub, id: p.id, uid: p.uid, result: userId })
    return userId
}

const i18n = (() => {
    const s = $(".comments")
    const get = (k: string, d: string) => attr(s, `data-i18n-${k}`) || d
    return {
        replyingTo: get("replying-to", "Replying to"),
        noComments: get("no-comments", "No comments yet."),
        loading: get("loading", "Loading..."),
        deleted: get("comment-deleted", "Comment deleted"),
        deletedByUser: get("comment-deleted-by-user", "Comment deleted by user"),
        moderated: get("comment-moderated", "Comment moderated"),
        deleteConfirm: get("delete-confirm", "Delete this comment?"),
        reply: get("reply", "Reply"),
    }
})()

const getDeletedCommentText = (c: Comment): string => {
    if (c.Status !== "deleted") return c.Text
    const reason = (c.Text || "").trim().toLowerCase()
    if (reason === "deleted_by_user") return i18n.deletedByUser
    if (reason === "moderated") return i18n.moderated
    return i18n.deleted
}

const api = {
    headers: (withToken = true): HeadersInit => {
        const h: HeadersInit = { "Content-Type": "application/json" }
        const t = withToken && getStoredAuthToken()
        if (t) h["X-Comment-Token"] = t
        return h
    },
    get: async (path: string, params: Record<string, any> = {}) => {
        const qs = new URLSearchParams()
        Object.keys(params).forEach((k) => {
            const v = params[k]
            if (v === undefined || v === null || v === "") return
            qs.append(k, String(v))
        })
        return fetch(`${endpoint}${path}?${qs}`, { headers: api.headers() })
    },
    post: async (path: string, body?: any) => fetch(`${endpoint}${path}`, {
        method: "POST", headers: api.headers(), body: body ? JSON.stringify(body) : undefined
    }),
}

type CommentsContextResponse = {
    success?: boolean
    items?: any[]
    total?: number
    target_comment_id?: number
    root_id?: number
    has_more_before?: boolean
    next_cursor?: string
}

async function requestWithAuthRetry(url: string, init: RequestInit): Promise<any> {
    const makeReq = async () => {
        const r = await fetch(url, init)
        const j = await r.json().catch(() => null)
        return { r, j }
    }

    let { r, j } = await makeReq()
    if (r.ok && (!j || j.success !== false)) return j

    const err = String(j?.error || j?.value || `HTTP ${r.status}`)
    if (!isExpiredToken(err)) throw new Error(err)

    const prevToken = getStoredAuthToken()
    localStorage.removeItem("comment_token")
    sessionStorage.removeItem("comment_token")
    document.cookie = "comment_token=; path=/; max-age=0"

    if (!loginWaitPromise) {
        login()
        loginWaitPromise = new Promise((res) => {
            const start = Date.now()
            const iv = setInterval(() => {
                const t = getStoredAuthToken()
                if (t && t !== prevToken) { clearInterval(iv); loginWaitPromise = null; res(t) }
                else if (Date.now() - start > 120000) { clearInterval(iv); loginWaitPromise = null; res(null) }
            }, 400)
        })
    }
    const newToken = await loginWaitPromise
    if (!newToken) throw new Error("Login required")

    const h = new Headers(init.headers || {})
    h.set("X-Comment-Token", newToken)
    if (!h.has("Content-Type")) h.set("Content-Type", "application/json")

    const retry = await fetch(url, { ...init, headers: h })
    const retryJ = await retry.json().catch(() => null)
    if (retry.ok && (!retryJ || retryJ.success !== false)) return retryJ
    throw new Error(String(retryJ?.error || retryJ?.value || `HTTP ${retry.status}`))
}

interface Comment {
    CommentId: number; SiteId: number; ParentId: number; Indent: number; ReplyCount: number
    Avatar: string; Username: string; ReplyToUsername: string; Text: string
    Likes: number; Dislikes: number; IsLiked: boolean; IsDisliked: boolean
    Status: string; UserId: number; Created: string; Path: string
}

function normalizeComment(raw: Record<string, any>, fallback: Partial<Comment> = {}): Comment {
    const parentId = toNum(raw?.ParentId ?? raw?.parent_id ?? fallback.ParentId)
    return {
        CommentId: toNum(raw?.CommentId ?? raw?.comment_id ?? fallback.CommentId),
        SiteId: toNum(raw?.SiteId ?? raw?.site_id ?? fallback.SiteId),
        ParentId: parentId,
        Indent: toNum(raw?.Indent ?? raw?.indent ?? fallback.Indent, parentId > 0 ? 1 : 0),
        ReplyCount: toNum(raw?.ReplyCount ?? raw?.reply_count ?? fallback.ReplyCount),
        Avatar: String(raw?.Avatar ?? raw?.avatar ?? fallback.Avatar ?? ""),
        Username: String(raw?.Username ?? raw?.username ?? fallback.Username ?? ""),
        ReplyToUsername: String(raw?.ReplyToUsername ?? raw?.reply_to_username ?? fallback.ReplyToUsername ?? ""),
        Text: String(raw?.Text ?? raw?.text ?? fallback.Text ?? ""),
        Likes: toNum(raw?.Likes ?? raw?.likes ?? fallback.Likes),
        Dislikes: toNum(raw?.Dislikes ?? raw?.dislikes ?? fallback.Dislikes),
        IsLiked: Boolean(raw?.IsLiked ?? raw?.is_liked ?? fallback.IsLiked),
        IsDisliked: Boolean(raw?.IsDisliked ?? raw?.is_disliked ?? fallback.IsDisliked),
        Status: String(raw?.Status ?? raw?.status ?? fallback.Status ?? "approved"),
        UserId: toNum(raw?.UserId ?? raw?.user_id ?? fallback.UserId),
        Created: String(raw?.Created ?? raw?.created ?? fallback.Created ?? ""),
        Path: String(raw?.Path ?? raw?.path ?? (fallback as any).Path ?? ""),
    }
}

const formatDate = (dateStr: string) => {
    if (!dateStr) return ""
    try {
        const d = new Date(dateStr)
        if (isNaN(d.getTime())) return ""
        const lang = globals.lang || "en"
        const date = new Intl.DateTimeFormat(lang, { day: "2-digit", month: "2-digit", year: "numeric" }).format(d)
        const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(d)
        return `${date}${lang.startsWith("ru") ? " в " : " at "}${time}`
    } catch { return "" }
}

const template = $("#comment-template-js") as HTMLTemplateElement | null

function revealCommentsList() {
    const list = $(".comments > ul")
    if (!list) return
    list.classList.add("comments-list-visible")
}

function setScoreTone(scoreEl: HTMLElement | null, score: number) {
    if (!scoreEl) return
    scoreEl.classList.remove("score-positive", "score-negative", "score-neutral")
    if (score > 0) scoreEl.classList.add("score-positive")
    else if (score < 0) scoreEl.classList.add("score-negative")
    else scoreEl.classList.add("score-neutral")
}

function renderComment(c: Comment): HTMLElement {
    const frag = template?.content.cloneNode(true) as DocumentFragment
    const li = frag?.querySelector("li") as HTMLElement
    const container = li?.querySelector(".comment-container") as HTMLElement
    if (!li || !container) throw new Error("Template not found")

    const id = Math.max(0, c.CommentId) || `tmp-${Date.now()}-${Math.random() * 1000 | 0}`
    const isDeleted = c.Status === "deleted"
    const currentUserId = getCurrentUserId()
    const isOwner = currentUserId > 0 && c.UserId > 0 && currentUserId === c.UserId

    container.dataset.commentId = String(c.CommentId || 0)
    container.id = `comment-${id}`
    container.dataset.parentId = String(c.ParentId || 0)
    container.dataset.replyCount = String(c.ReplyCount || 0)
    container.dataset.indent = String(c.Indent || 0)
    container.dataset.status = c.Status || "approved"
    container.dataset.userId = String(c.UserId || 0)
    container.style.setProperty("--comment-indent", String(c.Indent || 0))
    container.classList.toggle("is-reply", c.ParentId > 0)
    container.classList.toggle("own-comment", isOwner)
    if (isDeleted) container.classList.add("comment-deleted")

    const avatar = $(".avatar img", container) as HTMLImageElement
    if (!isDeleted && c.Avatar && avatar) { avatar.src = c.Avatar; avatar.alt = c.Username }

    const username = $(".comment-username", container)
    const date = $(".comment-date", container)
    if (username) username.textContent = isDeleted ? "" : c.Username
    if (date) date.textContent = isDeleted ? "" : formatDate(c.Created)

    const context = $(".comment-context", container)
    if (context && c.ParentId > 0 && !isDeleted) {
        const replyTo = c.ReplyToUsername || $(`.comment-container[data-comment-id="${c.ParentId}"] .comment-username`)?.textContent?.trim() || ""
        if (replyTo) container.dataset.replyToUsername = replyTo
        context.innerHTML = `<a class="comment-parent-link" href="#comment-${c.ParentId}" title="${i18n.replyingTo} ${replyTo}" aria-label="${i18n.replyingTo} ${replyTo}">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 20V10H9"/><path d="M9 10l4-4"/><path d="M9 10l4 4"/></svg>
    </a>`
        context.classList.remove("hidden")
    } else if (context) {
        context.textContent = ""
        context.classList.add("hidden")
    }

    const text = $(".comment-text", container)
    if (text) text.textContent = isDeleted ? getDeletedCommentText(c) : c.Text

    const actions = $(".comment-actions", container)
    const replyBox = $(".comment-reply", container)

    if (isDeleted) {
        actions?.classList.add("hidden")
        replyBox?.classList.add("hidden")
    } else {
        const permalink = $(".comment-permalink", container) as HTMLAnchorElement
        if (permalink) { permalink.href = `#comment-${id}`; permalink.textContent = "#" }

        $(".like-button", container)?.classList.toggle("active", c.IsLiked)
        $(".dislike-button", container)?.classList.toggle("active", c.IsDisliked)

        // Keep like/dislike visible for own comments, but make them inactive
        if (isOwner) {
            const likeBtn = $(".like-button", container) as HTMLButtonElement | null
            const dislikeBtn = $(".dislike-button", container) as HTMLButtonElement | null
            likeBtn?.classList.add("is-disabled")
            dislikeBtn?.classList.add("is-disabled")
            if (likeBtn) likeBtn.disabled = true
            if (dislikeBtn) dislikeBtn.disabled = true
        }

        const score = $(".score-count", container)
        if (score) {
            const scoreValue = c.Likes - c.Dislikes
            score.textContent = String(scoreValue)
            setScoreTone(score, scoreValue)
        }

        const replyBtn = $(".reply-button", container)
        const isCrossSite = toNum($(`.comments`)?.dataset.siteId) > 0 && c.SiteId > 0 && c.SiteId !== toNum($(`.comments`)?.dataset.siteId)
        if (replyBtn && (c.Indent >= MAX_INDENT || isCrossSite)) {
            replyBtn.classList.add("hidden")
            replyBox?.classList.add("hidden")
        } else if (replyBtn) {
            replyBtn.innerHTML = `<span>${i18n.reply}</span>`
        }

        const delBtn = $(".delete-button", container)
        if (delBtn && (isOwner || isCurrentUserAdminFlag)) delBtn.classList.remove("hidden")
    }

    return li
}

function getParentMeta(container: HTMLElement) {
    return {
        parentId: toNum(container.dataset.commentId),
        parentIndent: toNum(container.dataset.indent),
        totalReplies: toNum(container.dataset.replyCount),
        directReplyTotal: container.dataset.directReplyTotal === undefined ? toNum(container.dataset.replyCount, -1) : toNum(container.dataset.directReplyTotal, -1),
    }
}

function findThreadAnchor(parentLi: HTMLElement, parentContainer: HTMLElement): HTMLElement {
    const parentIndent = toNum(parentContainer.dataset.indent)
    let anchor: HTMLElement = parentLi
    let cursor = parentLi.nextElementSibling as HTMLElement | null

    while (cursor) {
        const c = $(".comment-container", cursor)
        if (!c) {
            if (cursor.classList.contains("comment-more-item")) {
                const moreParentId = toNum(cursor.dataset.parentId)
                const moreParent = moreParentId > 0 ? $(`.comment-container[data-comment-id="${moreParentId}"]`) : null
                const moreIndent = moreParent ? toNum(moreParent.dataset.indent) + 1 : parentIndent + 1
                if (moreIndent <= parentIndent) break
                anchor = cursor
                cursor = cursor.nextElementSibling as HTMLElement | null
                continue
            }
            cursor = cursor.nextElementSibling as HTMLElement | null
            continue
        }
        const indent = toNum(c.dataset.indent)
        if (indent <= parentIndent) break
        anchor = cursor
        cursor = cursor.nextElementSibling as HTMLElement | null
    }
    return anchor
}

function getDirectChildren(parentLi: HTMLElement, parentContainer: HTMLElement): HTMLElement[] {
    const { parentId, parentIndent } = getParentMeta(parentContainer)
    const children: HTMLElement[] = []
    let cursor = parentLi.nextElementSibling as HTMLElement | null

    while (cursor) {
        const c = $(".comment-container", cursor)
        if (!c) { cursor = cursor.nextElementSibling as HTMLElement | null; continue }
        const indent = toNum(c.dataset.indent)
        if (indent <= parentIndent) break
        if (toNum(c.dataset.parentId) === parentId) children.push(cursor)
        cursor = cursor.nextElementSibling as HTMLElement | null
    }
    return children
}

function setSubtreeVisibility(commentLi: HTMLElement, visible: boolean) {
    const container = $(".comment-container", commentLi)
    if (!container) return
    const rootIndent = toNum(container.dataset.indent)
    let cursor: HTMLElement | null = commentLi

    while (cursor) {
        const c = $(".comment-container", cursor)
        if (!c) {
            const li = cursor
            if (li.classList.contains("comment-more-item")) {
                const moreParentId = toNum(li.dataset.parentId)
                const moreParent = moreParentId > 0 ? $(`.comment-container[data-comment-id="${moreParentId}"]`) : null
                const moreIndent = moreParent ? toNum(moreParent.dataset.indent) + 1 : rootIndent + 1
                if (cursor !== commentLi && moreIndent <= rootIndent) break
                li.style.display = visible ? "" : "none"
                cursor = cursor.nextElementSibling as HTMLElement | null
                continue
            }
            cursor = cursor.nextElementSibling as HTMLElement | null
            continue
        }
        const indent = toNum(c.dataset.indent)
        if (cursor !== commentLi && indent <= rootIndent) break
        cursor.style.display = visible ? "" : "none"
        cursor = cursor.nextElementSibling as HTMLElement | null
    }
}

function getOrCreateMoreRepliesLi(parentLi: HTMLElement, parentContainer: HTMLElement): HTMLElement {
    const { parentId } = getParentMeta(parentContainer)
    const parentIndent = toNum(parentContainer.dataset.indent)
    const anchor = findThreadAnchor(parentLi, parentContainer)
    const existing = $(`.comment-more-item[data-parent-id="${parentId}"]`)

    if (existing) {
        if (existing.previousElementSibling !== anchor) anchor.insertAdjacentElement("afterend", existing)
        return existing
    }

    const moreLi = document.createElement("li")
    moreLi.className = "comment-more-item"
    moreLi.dataset.parentId = String(parentId)
    moreLi.style.marginInlineStart = `calc(${parentIndent + 1} * var(--comment-indent-step))`
    moreLi.innerHTML = `<button type="button" class="comment-more-btn" data-parent-id="${parentId}"></button>`
    anchor.insertAdjacentElement("afterend", moreLi)
    return moreLi
}

function updateMoreRepliesControl(parentLi: HTMLElement, parentContainer: HTMLElement) {
    const { parentId, directReplyTotal } = getParentMeta(parentContainer)
    const allDirect = getDirectChildren(parentLi, parentContainer)
    const hiddenDirect = allDirect.filter(li => li.style.display === "none")
    const visibleDirectCount = allDirect.length - hiddenDirect.length

    const hasNextCursor = Boolean(parentContainer.dataset.nextCursor)

    // Thread API contract: empty next_cursor means no more chunks available for this parent.
    // In this case parent-level "load more" must depend only on currently hidden direct nodes.
    if (!hasNextCursor && hiddenDirect.length <= 0) {
        $(`.comment-more-item[data-parent-id="${parentId}"]`)?.remove()
        return
    }

    let remainingDirect = 0
    if (hiddenDirect.length > 0) {
        remainingDirect = hiddenDirect.length
    } else if (directReplyTotal >= 0) {
        remainingDirect = Math.max(0, directReplyTotal - visibleDirectCount)
    } else if (hasNextCursor) {
        remainingDirect = 1
    }

    if (remainingDirect <= 0 || visibleDirectCount >= MAX_SIBLINGS) {
        $(`.comment-more-item[data-parent-id="${parentId}"]`)?.remove()
        return
    }

    const moreLi = getOrCreateMoreRepliesLi(parentLi, parentContainer)
    const count = remainingDirect
    moreLi.dataset.remaining = String(count)
    moreLi.dataset.hiddenDirect = String(hiddenDirect.length)

    const btn = $(".comment-more-btn", moreLi)
    if (btn) {
        btn.innerHTML = `<svg viewBox="0 0 24 24" class="icon-more-replies"><path fill="currentColor" d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg><span>${count}</span>`
    }
}

function collapseInitialReplies() {
    $$(".comments > ul > li").forEach(li => {
        const container = $(".comment-container", li)
        if (!container) return
        const children = getDirectChildren(li, container)
        const total = toNum(container.dataset.replyCount)
        if (children.length <= INITIAL_VISIBLE_REPLIES && total <= INITIAL_VISIBLE_REPLIES) return
        for (let i = INITIAL_VISIBLE_REPLIES; i < children.length; i++) {
            setSubtreeVisibility(children[i], false)
        }
        updateMoreRepliesControl(li, container)
    })
}

function focusNewComment(li: HTMLElement) {
    const container = $(".comment-container", li)
    if (!container?.id) return
    const hash = `#${container.id}`
    if (window.location.hash !== hash) window.history.replaceState({}, document.title, hash)
    container.setAttribute("tabindex", "-1")
    container.scrollIntoView({ behavior: "smooth", block: "center" })
    try { container.focus({ preventScroll: true }) } catch { container.focus() }
}

function revealCommentPath(commentId: number) {
    let currentId = commentId
    let guard = 0
    while (currentId > 0 && guard < 100) {
        const container = $(`.comment-container[data-comment-id="${currentId}"]`) as HTMLElement | null
        if (!container) break
        const li = container.closest("li") as HTMLElement | null
        if (li) setSubtreeVisibility(li, true)
        currentId = toNum(container.dataset.parentId)
        guard++
    }
}

function getReactionState(container: HTMLElement) {
    const likeBtn = $(".like-button, .like-button-alt", container)
    const dislikeBtn = $(".dislike-button, .dislike-button-alt", container)
    const scoreEl = $(".score-count", container)
    return {
        likeBtn, dislikeBtn, scoreEl,
        isLiked: likeBtn?.classList.contains("active") ?? false,
        isDisliked: dislikeBtn?.classList.contains("active") ?? false,
        score: toNum(scoreEl?.textContent),
    }
}

function setReactionState(container: HTMLElement, state: { isLiked: boolean; isDisliked: boolean; score: number }) {
    $(".like-button, .like-button-alt", container)?.classList.toggle("active", state.isLiked)
    $(".dislike-button, .dislike-button-alt", container)?.classList.toggle("active", state.isDisliked)
    const score = $(".score-count", container)
    if (score) {
        score.textContent = String(state.score)
        setScoreTone(score, state.score)
    }
}

async function loadComments(contentId: string | null, from = 0) {
    if (!contentId) return

    const section = $(".comments")
    const list = $(".comments > ul")
    if (!list) return

    const params = {
        content_id: contentId,
        sort: section?.dataset.sort || "threads_recent",
        size: Math.max(1, Math.min(100, toNum(section?.dataset.size, 50))),
        from,
        replies_limit: Math.max(1, toNum(section?.dataset.initialRepliesLimit, INITIAL_VISIBLE_REPLIES)),
        hot_size: from === 0 ? Math.max(0, Math.min(5, toNum(section?.dataset.hotSize, 0))) : 0,
        hot_min_likes: Math.max(1, toNum(section?.dataset.hotMinLikes, 1)),
        site_id: toNum(section?.dataset.siteId),
    }

    if (from === 0) {
        commentsLoadedFrom = 0
        commentsTotalCount = 0
        allCommentsLoaded = false
    }

    try {
        const res = await api.get("/list", params)
        const json = await res.json()
        if (!json.success || !json.items) {
            revealCommentsList()
            return
        }

        isCurrentUserAdminFlag = Boolean(json.is_admin)
        // Store minion user_id from API for ownership comparison
        if (json.current_user_id > 0) {
            currentMinionUserId = toNum(json.current_user_id)
            console.log("[comments] Got current_user_id from API:", currentMinionUserId)
            // Re-apply disabled state for SSR comments once exact minion user_id is known
            disableOwnCommentReactions()
        }
        commentsTotalCount = json.total || 0

        const items = [...(from === 0 && Array.isArray(json.hot_items) ? json.hot_items : []), ...json.items]
        commentsLoadedFrom += json.items.length
        if (commentsLoadedFrom >= commentsTotalCount) allCommentsLoaded = true

        if (from === 0) list.innerHTML = ""

        if (items.length === 0 && from === 0) {
            list.innerHTML = `<li><p>${i18n.noComments}</p></li>`
        } else {
            items.forEach((raw: any) => {
                const c = normalizeComment(raw)
                if (c.Status === "deleted" && c.ReplyCount <= 0) return
                list.appendChild(renderComment(c))
            })
            collapseInitialReplies()
        }

        // Fix z-indices and own comment states for all items
        disableOwnCommentReactions()

        revealCommentsList()
    } catch (e) {
        console.error("Failed to load comments", e)
        revealCommentsList()
    }
}


async function loadMoreComments(contentId: string | null) {
    if (!contentId || isLoadingMoreComments || allCommentsLoaded) return
    isLoadingMoreComments = true
    $(".comments-loading")?.classList.remove("hidden")

    try {
        await loadComments(contentId, commentsLoadedFrom)
    } finally {
        isLoadingMoreComments = false
        $(".comments-loading")?.classList.add("hidden")
    }
}

function getCommentIdFromHash(): number {
    const m = (window.location.hash || "").match(/^#comment-(\d+)$/)
    return m ? toNum(m[1]) : 0
}

function recomputeLoadedReplyCounts() {
    const all = $$(".comment-container[data-comment-id]")

    all.forEach(parent => {
        const parentId = toNum(parent.dataset.commentId)
        const parentIndent = toNum(parent.dataset.indent)
        if (parentId <= 0) return
        const parentLi = parent.closest("li") as HTMLElement | null
        if (!parentLi) return

        let descendantsCount = 0
        let directCount = 0
        let cursor = parentLi.nextElementSibling as HTMLElement | null
        while (cursor) {
            const c = $(".comment-container", cursor)
            if (!c) { cursor = cursor.nextElementSibling as HTMLElement | null; continue }
            const indent = toNum(c.dataset.indent)
            if (indent <= parentIndent) break
            descendantsCount++
            if (toNum(c.dataset.parentId) === parentId) directCount++
            cursor = cursor.nextElementSibling as HTMLElement | null
        }

        // In context-mode we have a bounded slice. Treat loaded data as authoritative snapshot
        // to avoid phantom "load more" controls that rely on stale denormalized counters.
        parent.dataset.replyCount = String(descendantsCount)
        parent.dataset.directReplyTotal = String(directCount)
        parent.dataset.nextCursor = ""
    })
}

function insertCommentsBatch(items: any[]) {
    const list = $(".comments > ul")
    if (!list || !Array.isArray(items) || items.length === 0) return

    const known = new Set($$(".comment-container[data-comment-id]").map(el => String(toNum(el.dataset.commentId))).filter(Boolean))
    const valid = items
        .map((raw: any) => normalizeComment(raw))
        .filter((c: Comment) => c.CommentId > 0 && !known.has(String(c.CommentId)) && !(c.Status === "deleted" && c.ReplyCount <= 0))

    if (valid.length === 0) return

    valid.sort((a, b) => {
        if (a.Path && b.Path) return a.Path.localeCompare(b.Path)
        if (a.Indent !== b.Indent) return a.Indent - b.Indent
        return a.CommentId - b.CommentId
    })

    let anchor: HTMLElement | null = null
    valid.forEach(c => {
        const el = renderComment(c)
        const parentLi = c.ParentId > 0 ? $(`.comment-container[data-comment-id="${c.ParentId}"]`)?.closest("li") as HTMLElement | null : null
        if (parentLi) {
            const parentContainer = $(".comment-container", parentLi)
            if (parentContainer) {
                const threadAnchor = findThreadAnchor(parentLi, parentContainer)
                threadAnchor.insertAdjacentElement("afterend", el)
                return
            }
        }
        if (anchor) {
            anchor.insertAdjacentElement("afterend", el)
        } else {
            list.appendChild(el)
        }
        anchor = el
    })

    // Context slice may contain partial thread and stale reply_count from backend.
    // Recompute from actually loaded DOM to prevent ghost "load more" controls.
    recomputeLoadedReplyCounts()

    if (isHashContextMode) {
        // In hash-context mode we must show the restored thread as-is and avoid
        // creating synthetic parent "load more" controls from local collapsing.
        $$(".comment-more-item").forEach(el => el.remove())
    } else {
        collapseInitialReplies()
    }
}

async function hydrateFromHashContext(contentId: string | null) {
    if (!contentId) return
    const targetId = getCommentIdFromHash()
    if (!targetId) return

    const existing = $(`#comment-${targetId}`)?.closest("li") as HTMLElement | null
    if (existing) {
        focusNewComment(existing)
        return
    }

    const section = $(".comments")
    const params: Record<string, any> = {
        content_id: contentId,
        comment_id: targetId,
        limit: 100,
        site_id: toNum(section?.dataset.siteId) || undefined,
        lang: (globals.lang || "").trim() || undefined,
    }

    try {
        const res = await api.get("/context", params)
        const json = await res.json() as CommentsContextResponse
        if (!json?.success || !Array.isArray(json.items) || json.items.length === 0) return

        const list = $(".comments > ul")
        // Hash-context hydration must replace current tree fully, otherwise stale
        // SSR/client controls (e.g. old .comment-more-item) can survive and create
        // ghost "load more" buttons that instantly disappear on click.
        if (list) {
            list.innerHTML = ""
        }

        isHashContextMode = true
        insertCommentsBatch(json.items)
        revealCommentsList()
        revealCommentPath(targetId)

        const target = $(`#comment-${targetId}`)?.closest("li") as HTMLElement | null
        if (target) focusNewComment(target)
    } catch (err) {
        console.error("Failed to hydrate comments context by hash", err)
    }
}

async function loadMoreReplies(parentId: number, parentLi: HTMLElement, parentContainer: HTMLElement, moreBtn: HTMLElement) {
    const section = $(".comments")
    const contentId = toNum(section?.dataset.contentId)
    if (!contentId) return

    const { directReplyTotal } = getParentMeta(parentContainer)
    const directChildren = getDirectChildren(parentLi, parentContainer)
    const hiddenDirect = directChildren.filter(li => li.style.display === "none")

    let cursor = parentContainer.dataset.nextCursor || ""
    let size = Math.max(1, toNum(section?.dataset.threadDirectSize, LOAD_MORE_BATCH))
    let repliesLimit = Math.max(1, toNum(parentContainer.dataset.threadRepliesLimitCurrent, toNum(section?.dataset.threadRepliesLimit, INITIAL_VISIBLE_REPLIES)))

    if (!cursor && directReplyTotal >= 0 && directChildren.length >= directReplyTotal) {
        cursor = ""
        size = Math.max(1, Math.min(50, directReplyTotal))
        repliesLimit = Math.min(50, repliesLimit + toNum(section?.dataset.threadRepliesLimit, INITIAL_VISIBLE_REPLIES))
        parentContainer.dataset.threadRepliesLimitCurrent = String(repliesLimit)
    }

    if ((moreBtn as HTMLButtonElement).disabled !== undefined) (moreBtn as HTMLButtonElement).disabled = true
    const prevText = moreBtn.textContent || ""
    moreBtn.textContent = i18n.loading

    try {
        const json = await requestWithAuthRetry(
            `${endpoint}/thread?content_id=${contentId}&parent_id=${parentId}&cursor=${encodeURIComponent(cursor)}&size=${size}&sort=${encodeURIComponent(section?.dataset.sort || "threads_recent")}&replies_limit=${repliesLimit}&site_id=${toNum(section?.dataset.siteId)}`,
            { method: "GET", headers: api.headers() }
        )

        let focusTarget: HTMLElement | null = null

        if (json.total >= 0) parentContainer.dataset.directReplyTotal = String(json.total)
        if (json.next_cursor !== undefined) parentContainer.dataset.nextCursor = json.next_cursor || ""

        if (hiddenDirect.length > 0) {
            const reveal = Math.min(LOAD_MORE_BATCH, hiddenDirect.length)
            for (let i = 0; i < reveal; i++) {
                setSubtreeVisibility(hiddenDirect[i], true)
                focusTarget = hiddenDirect[i]
            }
        }

        if (json.success && Array.isArray(json.items) && json.items.length > 0) {
            const known = new Set($$(".comment-container[data-comment-id]").map(el => el.dataset.commentId).filter(Boolean))
            const anchor = findThreadAnchor(parentLi, parentContainer)
            let lastAnchor: HTMLElement = anchor

            json.items.forEach((raw: any) => {
                const c = normalizeComment(raw, { ParentId: parentId })
                if (c.CommentId > 0 && known.has(String(c.CommentId))) return
                if (c.Status === "deleted" && c.ReplyCount <= 0) return
                const el = renderComment(c)
                lastAnchor.insertAdjacentElement("afterend", el)
                lastAnchor = el
                focusTarget = el
                if (c.CommentId > 0) known.add(String(c.CommentId))
            })
        }

        updateMoreRepliesControl(parentLi, parentContainer)
        disableOwnCommentReactions() // Update z-indices so new replies sit behind parents
        if (focusTarget) focusNewComment(focusTarget)
    } catch (err) {
        console.error("Failed to load more replies", err)
        moreBtn.textContent = prevText
    } finally {
        if ((moreBtn as HTMLButtonElement).disabled !== undefined) (moreBtn as HTMLButtonElement).disabled = false
        if (moreBtn.textContent === i18n.loading) updateMoreRepliesControl(parentLi, parentContainer)
    }
}

// Keep like/dislike visible but inactive for own comments on SSR-rendered content
function disableOwnCommentReactions() {
    const currentUserId = getCurrentUserId()
    const allComments = $$(".comment-container[data-user-id]")

    // Reverse z-index: higher index for earlier comments so they cover the lines of later comments
    const baseZIndex = 10000
    allComments.forEach((container, i) => {
        container.style.zIndex = String(baseZIndex - i)

        if (currentUserId <= 0) return
        const commentUserId = toNum(container.dataset.userId)
        if (commentUserId > 0 && commentUserId === currentUserId) {
            container.classList.add("own-comment")
            const likeBtn = $(".like-button", container) as HTMLButtonElement | null
            const dislikeBtn = $(".dislike-button", container) as HTMLButtonElement | null
            likeBtn?.classList.add("is-disabled")
            dislikeBtn?.classList.add("is-disabled")
            if (likeBtn) likeBtn.disabled = true
            if (dislikeBtn) dislikeBtn.disabled = true
        }
    })

    // Also update thread lines since layout might have changed or new comments added
    // Use requestAnimationFrame to ensure layout is settled (though usually it is sync)
    requestAnimationFrame(updateThreadLines)
}

function updateThreadLines() {
    $$(".comment-container.is-reply").forEach(child => {
        const parentId = child.dataset.parentId
        // Use attribute selector because container IDs might have tmp- prefix
        const parent = $(`.comment-container[data-comment-id="${parentId}"]`)
        if (!parent) return

        const childRect = child.getBoundingClientRect()
        const parentRect = parent.getBoundingClientRect()

        const childCenter = childRect.top + childRect.height / 2
        const parentCenter = parentRect.top + parentRect.height / 2
        const dist = childCenter - parentCenter

        if (dist > 0) {
            child.style.setProperty("--thread-height", `${dist}px`)
        }
    })
}

window.addEventListener("resize", () => {
    requestAnimationFrame(updateThreadLines)
})

// Event handlers
document.addEventListener("DOMContentLoaded", () => {
    const section = $(".comments")
    const list = $(".comments > ul")
    const sentinel = $(".comments-sentinel")
    if (!section || !list) return

    const contentId = attr(section, "data-content-id")
    const hasServerComments = !!$(".comment-container", list)
    const ssrCommentPage = toNum(section.dataset.commentPage, 1)
    const ssrCommentsTotal = toNum(section.dataset.commentsTotal, 0)
    const pageSize = Math.max(1, Math.min(100, toNum(section.dataset.size, 50)))

    // Keep reactions visible but inactive for own comments on page load
    disableOwnCommentReactions()

    if (hasServerComments) {
        // Keep SSR comments, do not re-render from page start to avoid flicker/CLS
        commentsLoadedFrom = (ssrCommentPage - 1) * pageSize + (list.querySelectorAll(":scope > li").length)
        commentsTotalCount = ssrCommentsTotal
        if (commentsLoadedFrom >= commentsTotalCount) allCommentsLoaded = true

        // Initialize thread controls for SSR comments (load-more replies button, collapsed replies state)
        collapseInitialReplies()
        revealCommentsList()
        void hydrateFromHashContext(contentId)
    } else {
        const observer = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting) {
                observer.disconnect()
                loadComments(contentId)
                void hydrateFromHashContext(contentId)
            }
        })
        observer.observe(section)
    }

    if (sentinel) {
        const scrollRoot = $(".comments-wrapper")
        const infiniteObserver = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && !isLoadingMoreComments && !allCommentsLoaded) {
                loadMoreComments(contentId)
            }
        }, { root: scrollRoot, rootMargin: "200px" })
        infiniteObserver.observe(sentinel)
    }

    // Click handlers
    document.body.addEventListener("click", async (e) => {
        const target = e.target as HTMLElement

        // Like/Dislike
        const reactionBtn = target.closest(".like-button, .dislike-button, .like-button-alt, .dislike-button-alt") as HTMLElement
        if (reactionBtn) {
            e.preventDefault()
            const container = reactionBtn.closest(".comment-container") as HTMLElement
            if (!container) return
            const commentId = container.dataset.commentId
            if (!commentId) return

            // Prevent liking/disliking own comments
            const commentUserId = toNum(container.dataset.userId)
            const currentUserId = getCurrentUserId()
            console.log("[comments] like/dislike check:", { commentUserId, currentUserId, match: commentUserId === currentUserId })
            if (commentUserId > 0 && currentUserId > 0 && commentUserId === currentUserId) {
                console.log("[comments] blocked self-like")
                return
            }

            const isLike = reactionBtn.classList.contains("like-button") || reactionBtn.classList.contains("like-button-alt")
            const prev = getReactionState(container)
            const next = { ...prev }

            if (isLike) {
                if (prev.isLiked) { next.isLiked = false; next.score = prev.score - 1 }
                else { next.isLiked = true; next.score = prev.score + 1; if (prev.isDisliked) { next.isDisliked = false; next.score += 1 } }
            } else {
                if (prev.isDisliked) { next.isDisliked = false; next.score = prev.score + 1 }
                else { next.isDisliked = true; next.score = prev.score - 1; if (prev.isLiked) { next.isLiked = false; next.score -= 1 } }
            }

            setReactionState(container, next)
            try {
                await requestWithAuthRetry(`${endpoint}/${commentId}/${isLike ? "like" : "dislike"}`, { method: "POST", headers: api.headers() })
            } catch (err) {
                setReactionState(container, prev)
                console.error(err)
            }
            return
        }

        // Load more replies
        const moreBtn = target.closest(".comment-more-btn") as HTMLButtonElement
        const fallbackLink = !moreBtn ? target.closest(".comment-more-item a") as HTMLAnchorElement : null
        if (moreBtn || fallbackLink) {
            e.preventDefault()
            const control = (moreBtn || fallbackLink)!
            const moreItem = control.closest(".comment-more-item") as HTMLElement | null
            const parentId = toNum(control.dataset.parentId || moreItem?.dataset.parentId)
            if (!parentId) return
            const parentContainer = $(`.comment-container[data-comment-id="${parentId}"]`)
            if (!parentContainer) return
            const parentLi = parentContainer.closest("li")
            if (!parentLi) return
            await loadMoreReplies(parentId, parentLi as HTMLElement, parentContainer, control)
            return
        }

        // Reply toggle
        if (target.closest(".reply-button")) {
            const btn = target.closest(".reply-button")!
            const container = btn.closest(".comment-container") as HTMLElement
            if (!container) return
            const replyBox = $(".comment-reply", container)
            if (replyBox) {
                replyBox.classList.toggle("active")
                if (replyBox.classList.contains("active")) {
                    const input = $("textarea", replyBox) as HTMLTextAreaElement
                    if (input) input.focus()
                }
            }
            return
        }

        // Delete
        if (target.closest(".delete-button")) {
            e.preventDefault()
            const btn = target.closest(".delete-button") as HTMLButtonElement
            const container = btn.closest(".comment-container") as HTMLElement
            if (!container) return
            const commentId = container.dataset.commentId
            if (!commentId || commentId === "0") return
            if (!confirm(i18n.deleteConfirm)) return

            btn.disabled = true
            try {
                await requestWithAuthRetry(`${endpoint}/delete?comment_id=${commentId}`, { method: "POST", headers: api.headers() })

                const replyCount = toNum(container.dataset.replyCount)
                if (replyCount > 0) {
                    container.classList.add("comment-deleted")
                    container.dataset.status = "deleted"
                    const text = $(".comment-text", container)
                    if (text) text.textContent = i18n.deleted
                    $(".comment-username", container)!.textContent = ""
                    const context = $(".comment-context", container)
                    if (context) { context.textContent = ""; context.classList.add("hidden") }
                    $(".comment-actions", container)?.classList.add("hidden")
                    $(".comment-reply", container)?.classList.add("hidden")
                    const avatar = $(".avatar img", container) as HTMLImageElement
                    if (avatar) avatar.src = "/images/avatar_placeholder.png"
                } else {
                    const li = container.closest("li")
                    if (li) {
                        const parentId = toNum(container.dataset.parentId)
                        if (parentId > 0) {
                            const parentContainer = $(`.comment-container[data-comment-id="${parentId}"]`)
                            if (parentContainer) {
                                const count = toNum(parentContainer.dataset.replyCount)
                                if (count > 0) parentContainer.dataset.replyCount = String(count - 1)
                                const parentLi = parentContainer.closest("li")
                                if (parentLi) updateMoreRepliesControl(parentLi as HTMLElement, parentContainer)
                            }
                        }
                        li.remove()
                    }
                }
            } catch (err) {
                console.error("Failed to delete comment", err)
                alert(String(err instanceof Error ? err.message : "Error deleting comment"))
            } finally {
                btn.disabled = false
            }
            return
        }

        // Send comment
        const sendBtn = target.closest(".send-comment-button, .submit-btn")
        if (sendBtn) {
            e.preventDefault()
            const isReply = sendBtn.classList.contains("send-comment-button")

            let input: HTMLTextAreaElement | null = null
            let contentId = 0
            let replyToId = 0

            if (isReply) {
                const container = sendBtn.closest(".comment-container") as HTMLElement
                if (!container) return
                input = $(".comment-reply textarea", container) as HTMLTextAreaElement
                replyToId = toNum(container.dataset.commentId)
                contentId = toNum($(".comments")?.dataset.contentId)
            } else {
                const form = sendBtn.closest(".comment-form")
                if (!form) return
                input = $("textarea", form) as HTMLTextAreaElement
                contentId = toNum($(".comments")?.dataset.contentId)
            }

            if (!input?.value.trim() || !contentId) return

            const text = input.value.trim()
            sendBtn.setAttribute("disabled", "true")

            try {
                const json = await requestWithAuthRetry(`${endpoint}/add`, {
                    method: "POST",
                    headers: api.headers(),
                    body: JSON.stringify({ content_id: contentId, text, reply_to_comment_id: replyToId }),
                })

                if (json.success && json.comment) {
                    input.value = ""
                    const c = normalizeComment(json.comment, { ParentId: replyToId })
                    const el = renderComment(c)

                    if (replyToId > 0) {
                        const parentContainer = $(`.comment-container[data-comment-id="${replyToId}"]`)
                        if (parentContainer) {
                            const parentLi = parentContainer.closest("li") as HTMLElement
                            if (parentLi) {
                                const anchor = findThreadAnchor(parentLi, parentContainer)
                                anchor.insertAdjacentElement("afterend", el)
                                const count = toNum(parentContainer.dataset.replyCount)
                                parentContainer.dataset.replyCount = String(count + 1)
                                updateMoreRepliesControl(parentLi, parentContainer)
                                focusNewComment(el)
                                $(".comment-reply", parentContainer)?.classList.remove("active")
                            }
                        }
                    } else {
                        const list = $(".comments > ul")
                        if (list) {
                            const firstLi = $("li", list)
                            if (firstLi && !$(".comment-container", firstLi)) firstLi.remove()
                            list.insertAdjacentElement("afterbegin", el)
                            focusNewComment(el)
                        }
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
                sendBtn.removeAttribute("disabled")
            }
        }
    })
})
