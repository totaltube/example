import { getAuthToken as getStoredAuthToken } from "../auth";

/**
 * Global types for site configuration.
 */
export type Globals = {
    lang: string;
    captcha_key: string;
    comments_endpoint?: string
};

/**
 * Object containing global data injected via the window object.
 */
export const globals = (window as any).globals as Globals;

/**
 * Base URL for the comments API.
 */
export const endpoint = globals.comments_endpoint || "/api-comments";

// --- Constants for rendering logic and behavior ---
export const INITIAL_VISIBLE_REPLIES = 2;
export const LOAD_MORE_BATCH = 5;
export const MAX_INDENT = 9;
export const MAX_SIBLINGS = 1000;

// --- Application State ---
/** Admin flag for the current user */
export let state = {
    isCurrentUserAdmin: false,
    currentMinionUserId: 0,
    commentsLoadedFrom: 0,
    commentsTotalCount: 0,
    isLoadingMoreComments: false,
    allCommentsLoaded: false,
    isHashContextMode: false,
};

/**
 * Utility for updating state flags.
 */
export function updateState(updates: Partial<typeof state>) {
    Object.assign(state, updates);
}

/**
 * Interface representing a single comment from the API.
 */
export interface Comment {
    CommentId: number;
    SiteId: number;
    ParentId: number;
    Indent: number;
    ReplyCount: number;
    Avatar: string;
    Username: string;
    ReplyToUsername: string;
    Text: string;
    Likes: number;
    Dislikes: number;
    IsLiked: boolean;
    IsDisliked: boolean;
    Status: string;
    UserId: number;
    Created: string;
    Path: string;
}
