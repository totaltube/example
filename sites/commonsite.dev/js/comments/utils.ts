import { getAuthToken as getStoredAuthToken } from "../auth";
import { state, globals, Comment } from "./types";

/**
 * Converts a value to a number, with a default value on error.
 */
export const toNum = (v: any, d = 0) => {
    const n = Number(v);
    return isFinite(n) ? n : d;
};

/**
 * Checks an error message for an expired token.
 */
export const isExpiredToken = (m: string) => /token is expired|invalid user token/i.test(m);

/**
 * Parses a JWT token without signature verification.
 */
export const parseJwt = (t: string) => {
    try {
        const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(decodeURIComponent(atob(b).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
    } catch { return null; }
};

/**
 * Returns the current user's ID. Priority: Minion response, then stored JWT.
 */
export const getCurrentUserId = () => {
    if (state.currentMinionUserId > 0) return state.currentMinionUserId;
    const t = getStoredAuthToken();
    if (!t) return 0;
    const p = parseJwt(t);
    return toNum(p?.user_id ?? p?.userId ?? p?.sub ?? p?.id ?? p?.uid);
};

/**
 * Formats a date string into "DD.MM.YYYY at HH:MM" format.
 */
export const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return "";
        const lang = globals.lang || "en";
        const date = new Intl.DateTimeFormat(lang, { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
        const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(d);
        return `${date}${lang.startsWith("ru") ? " в " : " at "}${time}`;
    } catch { return ""; }
};

/**
 * Standardizes raw comment data into a typed object.
 */
export function normalizeComment(raw: Record<string, any>, fallback: Partial<Comment> = {}): Comment {
    const parentId = toNum(raw?.ParentId ?? raw?.parent_id ?? fallback.ParentId);
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
    };
}
