/**
 * Helper for selecting a single element (similar to jQuery $).
 */
export const $ = (sel: string, el?: Element) => (el || document).querySelector(sel) as HTMLElement | null;

/**
 * Helper for selecting a list of elements (similar to jQuery $$).
 */
export const $$ = (sel: string, el?: Element) => Array.from((el || document).querySelectorAll(sel)) as HTMLElement[];

/**
 * Retrieves the value of an element's attribute.
 */
export const attr = (el: Element | null, name: string) => el?.getAttribute(name);

/**
 * i18n translations object, initialized once on load from data-attributes.
 */
export const i18n = (() => {
    const s = $(".comments");
    const get = (k: string, d: string) => attr(s, `data-i18n-${k}`) || d;
    return {
        replyingTo: get("replying-to", "Replying to"),
        noComments: get("no-comments", "No comments yet."),
        loading: get("loading", "Loading..."),
        deleted: get("comment-deleted", "Comment deleted"),
        deletedByUser: get("comment-deleted-by-user", "Comment deleted by user"),
        moderated: get("comment-moderated", "Comment moderated"),
        deleteConfirm: get("delete-confirm", "Delete this comment?"),
        reply: get("reply", "Reply"),
    };
})();
