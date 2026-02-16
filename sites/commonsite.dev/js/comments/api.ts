import { getAuthToken as getStoredAuthToken, clearAuth } from "../auth";
import { endpoint } from "./types";
import { isExpiredToken } from "./utils";

/**
 * Object for interacting with the comments API.
 * Supports automatic retry on token expiration (quiet logout).
 */
export const api = {
    /** Build request headers */
    headers: (token = getStoredAuthToken()): HeadersInit => {
        const h: HeadersInit = { "Content-Type": "application/json" };
        if (token) h["X-Comment-Token"] = token;
        return h;
    },

    /** Base method for executing requests with auto-login handling */
    req: async (path: string, init: RequestInit = {}): Promise<any> => {
        const url = path.startsWith("http") ? path : `${endpoint}${path}`;
        const make = (token?: string) => fetch(url, { ...init, headers: api.headers(token) });

        let r = await make();
        let j = await r.json().catch(() => null);
        if (r.ok && (!j || j.success !== false)) return j;

        const err = String(j?.error || j?.value || `HTTP ${r.status}`);
        if (!isExpiredToken(err)) throw new Error(err);

        // If token is expired - clear auth (quiet logout)
        clearAuth();

        // If it was a GET request - try repeating anonymously
        if (init.method === "GET") {
            r = await make(""); // Empty token
            j = await r.json().catch(() => null);
            if (r.ok && (!j || j.success !== false)) return j;
            throw new Error(String(j?.error || j?.value || `HTTP ${r.status}`));
        }

        // For POST and others - just throw error. UI has already switched to "logged-out" via clearAuth.
        throw new Error("Session expired. Please login again.");
    },

    /** GET request with parameters */
    get: (path: string, params: Record<string, any> = {}) => {
        const qs = new URLSearchParams();
        for (const k in params) {
            if (params[k] != null && params[k] !== "") qs.append(k, String(params[k]));
        }
        const queryString = qs.toString();
        return api.req(`${path}${queryString ? "?" + queryString : ""}`, { method: "GET" });
    },

    /** POST request */
    post: (path: string, body?: any) => api.req(path, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined
    }),
};
