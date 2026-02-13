const AUTH_STORAGE_KEY = "comment_token"
let AUTH_URL = "https://auth.totaltube.com/login" // Placeholder, should probably be in globals

export function getAuthToken(): string | null {
    try {
        return localStorage.getItem(AUTH_STORAGE_KEY) || sessionStorage.getItem(AUTH_STORAGE_KEY)
    } catch (e) {
        console.warn("Auth: Failed to access storage", e)
        return null
    }
}

export function isLoggedIn(): boolean {
    return !!getAuthToken()
}

export function logout() {
    try {
        localStorage.removeItem(AUTH_STORAGE_KEY)
        sessionStorage.removeItem(AUTH_STORAGE_KEY)
        document.cookie = `${AUTH_STORAGE_KEY}=; path=/; max-age=0`
    } catch (e) {
        console.error("Auth: Failed to clear storage", e)
    }
    updateAuthUI()
    window.location.reload()
}

export function login() {
    // Current URL as origin/callback
    const currentUrl = window.location.href
    // Construct Auth URL
    const targetUrl = new URL(AUTH_URL)
    targetUrl.searchParams.set("origin", window.location.origin)

    // Try Popup first
    const width = 600
    const height = 700
    const left = (window.innerWidth - width) / 2
    const top = (window.innerHeight - height) / 2

    // Add popup mode param
    targetUrl.searchParams.set("mode", "popup")

    const popup = window.open(
        targetUrl.toString(),
        "totaltube_auth",
        `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes,status=yes`
    )

    if (popup && !popup.closed && typeof popup.closed !== "undefined") {
        // Popup opened successfully
        console.log("Auth popup opened")
        // We listener is already set up in initAuth()
    } else {
        // Popup blocked or failed - Fallback to Redirect
        console.log("Popup blocked, falling back to redirect")
        // Update mode to redirect
        targetUrl.searchParams.set("mode", "redirect")
        targetUrl.searchParams.set("redirect_url", currentUrl) // Redirect back here
        window.location.href = targetUrl.toString()
    }
}

export function handleCallback() {
    // Check if we are returning from a redirect login (Token in URL)
    const params = new URLSearchParams(window.location.search)
    const token = params.get("token")
    if (token) {
        try {
            localStorage.setItem(AUTH_STORAGE_KEY, token)
            // Set cookie for SSR
            document.cookie = `${AUTH_STORAGE_KEY}=${token}; path=/; max-age=31536000; SameSite=Lax`
        } catch (e) {
            console.error("Auth: Failed to save token", e)
        }
        // Clean URL
        const newUrl = window.location.pathname + window.location.hash
        window.history.replaceState({}, document.title, newUrl)
        updateAuthUI()
    }
}

export function updateAuthUI() {
    const loggedIn = isLoggedIn()
    console.log("Auth: Updating UI. LoggedIn:", loggedIn)
    // Toggle visibility of Login/Logout buttons
    document.body.classList.toggle("logged-in", loggedIn)
    document.body.classList.toggle("logged-out", !loggedIn)

    // User Info Display
    if (loggedIn) {
        const token = getAuthToken()
        console.log("Auth: Token exists:", !!token)
        if (token) {
            const user = parseJwt(token)
            console.log("Auth: User info:", user)
            if (user) {
                const nameEls = document.querySelectorAll(".auth-user-name")
                console.log(`Auth: Found ${nameEls.length} name elements`)
                nameEls.forEach(el => {
                    el.textContent = user.name || user.email || "User"
                })

                const avatarEls = document.querySelectorAll(".auth-user-avatar")
                console.log(`Auth: Found ${avatarEls.length} avatar elements`)
                avatarEls.forEach(el => {
                    if (user.picture) {
                        (el as HTMLImageElement).src = user.picture
                    }
                })
            } else {
                console.warn("Auth: Failed to parse user from token")
            }
        }
    }

    const loginBtns = document.querySelectorAll(".auth-login-btn")
    loginBtns.forEach(el => {
        (el as HTMLElement).style.display = loggedIn ? "none" : ""
    })

    const logoutBtns = document.querySelectorAll(".auth-logout-btn")
    logoutBtns.forEach(el => {
        (el as HTMLElement).style.display = loggedIn ? "" : "none"
    })

    // User Profile Container
    const profileEls = document.querySelectorAll(".auth-profile")
    console.log(`Auth: Found ${profileEls.length} profile elements to toggle`)
    profileEls.forEach(el => {
        (el as HTMLElement).style.display = loggedIn ? "flex" : "none"
        console.log("Auth: Set profile display to", (el as HTMLElement).style.display)
    })
}

function parseJwt(token: string) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        console.error("Auth: Failed to parse JWT", e)
        return null
    }
}

export function initAuth(authUrl?: string) {
    console.log("Auth: Initializing", authUrl)
    if (authUrl) AUTH_URL = authUrl
    // 1. Check for callback token (Redirect flow)
    handleCallback()

    // 2. Setup PostMessage listener (Popup flow)
    window.addEventListener("message", (event) => {
        // Verify origin - strictly should match AUTH_URL domain
        // For now, accept if it looks like our auth service
        // const allowedOrigin = new URL(AUTH_URL).origin
        // if (event.origin !== allowedOrigin) return 

        if (event.data && event.data.type === "auth_token" && event.data.token) {
            console.log("Received token from popup")
            try {
                localStorage.setItem(AUTH_STORAGE_KEY, event.data.token)
            } catch (e) {
                console.error("Auth: Failed to save token from popup", e)
            }
            updateAuthUI()
            // Optionally reload page to refresh comments etc
            // window.location.reload() 
        }
    })

    // 3. Initial UI state
    // Sync cookie if missing (for existing logged-in users)
    const token = getAuthToken()
    if (token && document.cookie.indexOf(AUTH_STORAGE_KEY + "=") === -1) {
        document.cookie = `${AUTH_STORAGE_KEY}=${token}; path=/; max-age=31536000; SameSite=Lax`
    }
    updateAuthUI()

    // 4. Bind Global Event Listeners for buttons (using delegation)
    document.addEventListener("click", (e) => {
        const target = e.target as Element
        if (target.closest(".auth-login-btn")) {
            e.preventDefault()
            login()
        }
        if (target.closest(".auth-logout-btn")) {
            e.preventDefault()
            logout()
        }
    })
}
