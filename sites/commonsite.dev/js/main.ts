// Main javascript
// noinspection DuplicatedCode

import autocomplete, { AutocompleteItem } from "autocompleter"
import micromodal from "micromodal"

// var defined in layout.twig
export type Globals = {
    autocomplete: string
    search: string
    model: string
    channel: string
    category: string
    lang_template: string
    search_param: string
    search_natural_param: string
    multi_language: boolean
    default_language?: string
    no_redirect_default_language?: boolean
    lang: string
    locale: string
    dmca: string
    captcha_key: string
    out: string
    count: boolean
    page_template: string
    trade: boolean
    trade_template: string
    thumb_rotate_delay: number
    under: string
    auth_url: string
}

// Doing everything after html loaded.
document.addEventListener("DOMContentLoaded", function () {
    // globals is the object containing some vars defined in layout.twig
    const globals = (window as any).globals as Globals
    // Add global indexes to thumb links if not already present
    const firstThumbLink = document.querySelector(".thumbs a.thumb-link")
    if (firstThumbLink && !firstThumbLink.hasAttribute("data-index")) {
        let globalIndex = 0
        document.querySelectorAll(".thumbs a.thumb-link").forEach(link => {
            if (!link.hasAttribute("data-index")) {
                link.setAttribute("data-index", globalIndex.toString())
                globalIndex++
            }
        })
    }
    // prevent default action on dropdown anchors
    document.querySelectorAll(".dropdown > a").forEach(el =>
        el.addEventListener("click", e => e.preventDefault()),
    )
    // format numbers to locale specific format
    document.querySelectorAll("[data-number]").forEach(function (el) {
        try {
            el.innerHTML = parseInt(el.getAttribute("data-number")).toLocaleString(globals.locale ? globals.locale.replace("_", "-") : undefined)
        } catch (e) {
            el.innerHTML = el.getAttribute("data-number")
        }
    })

    // search form autocomplete
    type SearchItem = {
        suggest: string
        lang: string
        total: number
        id?: number
        slug?: string
        type?: "model" | "channel" | "category"
    }
    type SearchesAutocompleteItem = SearchItem & AutocompleteItem;
    var controller, signal

    // function to build the url to model, channel, category or search page
    function buildUrl(item: SearchItem) {
        let url_template: string
        let addQueryParam = false // if we need to add search query param to the search url or query param will be inside the url.
        if (item.type === "model") {
            url_template = globals.model
        } else if (item.type === "channel") {
            url_template = globals.channel
        } else if (item.type === "category") {
            url_template = globals.category
        } else {
            url_template = globals.search
            if (!url_template.includes("{query}")) {
                addQueryParam = true
            }
        }
        url_template = url_template
            .replace("{slug}", encodeURIComponent(item.slug || ""))
            .replace("{id}", item.id?.toString() || "")
            .replace("{query}", encodeURIComponent(item.suggest || ""))
        if (globals.multi_language && (globals.default_language !== globals.lang || !globals.no_redirect_default_language)) {
            url_template = globals.lang_template.replace("{lang}", globals.lang).replace("{route}", url_template)
        }
        if (addQueryParam) {
            url_template += "?" + globals.search_param + "=" + encodeURIComponent(item.suggest)
        }
        return url_template
    }

    document.querySelectorAll("input[name=q]").forEach((input: HTMLInputElement) => {
        // set search form submit handling
        input.closest("form").addEventListener("submit", function (e) {
            e.preventDefault()
            let searchUrl = globals.search
            if (globals.multi_language && (globals.default_language !== globals.lang || !globals.no_redirect_default_language)) {
                searchUrl = globals.lang_template
                    .replace("{lang}", globals.lang)
                    .replace("{route}", globals.search)
            }
            var urlParams = new URLSearchParams()
            urlParams.set(globals.search_natural_param, "true")
            if (searchUrl.includes("{query}")) {
                searchUrl = searchUrl.replace("{query}", encodeURIComponent(input.value))
            } else {
                urlParams.set(globals.search_param, input.value)
            }
            window.location.href = searchUrl + "?" + urlParams.toString()
        })
        // set search form autocomplete
        autocomplete<SearchesAutocompleteItem>({
            input,
            emptyMsg: "",
            minLength: 0,
            disableAutoSelect: true,
            // fetching suggested autocomplete items from the server
            fetch: (text: string, update: (items: SearchItem[]) => void) => {
                // function to fetch search suggest messages
                (async () => {
                    try {
                        if (controller) controller.abort()
                        controller = new AbortController()
                        signal = controller.signal
                    } catch (e) {
                    }
                    let autocompleteUrl = globals.autocomplete
                    if (globals.multi_language && (globals.default_language !== globals.lang || !globals.no_redirect_default_language)) {
                        autocompleteUrl = globals.lang_template
                            .replace("{lang}", globals.lang)
                            .replace("{route}", globals.autocomplete)
                    }
                    try {
                        const res = await fetch(`${autocompleteUrl}?q=${encodeURIComponent(text)}`, { signal })
                        const json = await res.json()
                        update(json)
                    } catch (err) {
                        console.log(err)
                        update([])
                    }
                    controller = undefined
                    signal = undefined
                })()
            },
            onSelect: (item) => {
                window.location.href = buildUrl(item)
            },
            render: function (item: SearchItem, currentValue: string): HTMLDivElement | undefined {
                // Creating container div
                const itemElement = document.createElement("div")
                // Creating anchor with suggest text and other data
                const anchorElement = document.createElement("a")
                anchorElement.style.display = "block"
                anchorElement.style.width = "100%"
                anchorElement.style.position = "relative"
                anchorElement.style.color = "inherit"
                anchorElement.style.textDecoration = "none"
                anchorElement.style.overflow = "hidden"
                // Creating element holding suggest text
                const suggestElement = document.createElement("span")
                // escaping current value to use in regex
                const currentValueRegex = currentValue.replace(/[-[\]{}()*+!<=:?.\/\\^$|#\s,]/g, "\\$&")
                const re = new RegExp(currentValueRegex, "gi")
                if (currentValue.length > 0) {
                    // splitting suggested search message to highlight currently typed chars.
                    const parts = item.suggest.split(re)
                    for (let i = 0; i < parts.length; i++) {
                        suggestElement.appendChild(document.createTextNode(parts[i]))
                        if (i < parts.length - 1) {
                            const highlightElement = document.createElement("span")
                            highlightElement.classList.add("highlight")
                            highlightElement.textContent = currentValue
                            suggestElement.appendChild(highlightElement)
                        }
                    }
                } else {
                    suggestElement.textContent = item.suggest
                }
                anchorElement.appendChild(suggestElement)
                const totalElement = document.createElement("span")
                totalElement.textContent = item.total.toString()
                totalElement.style.position = "absolute"
                totalElement.style.right = "0"
                totalElement.classList.add("total")
                anchorElement.appendChild(totalElement)
                // Now add href attr to anchor
                anchorElement.setAttribute("href", buildUrl(item))
                itemElement.appendChild(anchorElement)
                return itemElement
            },
        })
    })
    // links with param data-new=true will be opened in new window
    document.querySelectorAll("a[data-new=true]").forEach(el => {
        el.addEventListener("click", () => {
            const href = el.getAttribute("href")
            try {
                const targetWindowName = "site-" + Math.random().toString()
                const w = window.open("", targetWindowName)
                if (w) {
                    if (navigator.userAgent.match(/Firefox/i)) {
                        if (globals.under) w.location.href = globals.under
                        else (el as HTMLAnchorElement).rel = ""
                    }
                    (el as HTMLAnchorElement).href = href;
                    (el as HTMLAnchorElement).target = targetWindowName
                    return
                }
            } catch (e) {
            }
        })
    })
    // Counting clicks to links
    document.querySelectorAll(".thumbs").forEach(el => {
        // to speedup we listen only on .thumbs selector and use bubbling to find anchor that was clicked.
        el.addEventListener("click", event => {
            let clickedAnchor = event.target as HTMLAnchorElement
            if (clickedAnchor.tagName !== "a") {
                if (clickedAnchor.closest(".dmca-link")) {
                    // ignore dmca link
                    clickedAnchor = null
                } else {
                    // if image or another inner element was clicked inside anchor we will find the actual anchor
                    clickedAnchor = clickedAnchor.closest("a")
                }
            }
            if (clickedAnchor && clickedAnchor.matches("a.thumb-link")) {
                const href = clickedAnchor.getAttribute("href")
                const contentId = clickedAnchor.getAttribute("data-id")
                const categoryId = clickedAnchor.getAttribute("data-category-id") || ""
                const thumbId = clickedAnchor.getAttribute("data-thumb-id") || "-1"
                const position = clickedAnchor.getAttribute("data-index") || "-1"
                const newWindow = clickedAnchor.getAttribute("data-target") === "_blank"
                const type = globals.page_template === "top-categories" ? "tca" : globals.page_template === "top-content" ? "tc" :
                    globals.page_template == "category" ? "c" : ""
                const params = new URLSearchParams({
                    t: type,
                    cid: categoryId,
                    id: contentId,
                    tid: thumbId,
                    pos: position,
                })
                let url = href
                if (globals.trade) {
                    url = globals.trade_template.replace(/{{\s*encoded_url\s*}}/, encodeURIComponent(url))
                        .replace(/{{\s*url\s*}}/, url)
                        .replace(/{{\s*lang\s*}}/, globals.lang)
                }
                if (newWindow) {
                    let countUrl = globals.out + "?" + params.toString()
                    try {
                        const targetWindowName = "site-" + Math.random().toString()
                        const w = window.open("", targetWindowName)
                        if (w) {
                            clickedAnchor.href = url
                            clickedAnchor.target = targetWindowName
                            clickedAnchor.rel = "noopener"
                            if (navigator.userAgent.match(/Firefox/i)) {
                                if (globals.under) w.location.href = globals.under
                                else clickedAnchor.rel = ""
                            }
                            setTimeout(() => clickedAnchor.setAttribute("href", href), 300)
                            fetch(countUrl)
                                .then(val => val.json())
                                .then(json => !json.success && console.error(json))
                            return
                        }
                    } catch (e) {
                        // If something wrong with window.open - we will try another method to redirect
                    }
                }
                // if link opening in same window, we send to out script which will do count and redirect
                params.set("r", url)
                // changing anchor href attribute to the count link and changing it back to original after 100ms
                clickedAnchor.setAttribute("href", globals.out + "?" + params.toString())
                window.setTimeout(() => clickedAnchor.setAttribute("href", href), 300)
            }
        })
    })
    // dmca dialog
    let captchaScriptLoaded = false
    let captchaWidgetId = null
    let timeoutId = null
    micromodal.init()
    const form = document.querySelector("#dmca form")
    form.addEventListener("submit", e => {
        e.preventDefault()
        form.querySelectorAll(".success,.error").forEach(el => {
            (el as HTMLDivElement).style.display = "none"
        })
        const captchaResponseSelector = form.querySelector("[name=h-captcha-response]")
        let captchaKey = ""
        if (captchaResponseSelector) {
            captchaKey = (captchaResponseSelector as HTMLInputElement).value
        }
        const data = {
            reason: (form.querySelector("#reason") as HTMLInputElement).value,
            info: (form.querySelector("#info") as HTMLTextAreaElement).value,
            email: (form.querySelector("#email") as HTMLInputElement).value,
            content_id: parseInt((form.querySelector("[name=content_id]") as HTMLInputElement).value),
            lang: globals.lang,
            "h-captcha-response": captchaKey,
        }
        sessionStorage.setItem("dmca-last-reason", data.reason)
        sessionStorage.setItem("dmca-last-email", data.email)
        sessionStorage.setItem("dmca-last-info", data.info)
        let dmcaUrl = globals.dmca
        if (globals.multi_language && (globals.default_language !== globals.lang || !globals.no_redirect_default_language)) {
            dmcaUrl = globals.lang_template.replace("{route}", dmcaUrl).replace("{lang}", globals.lang)
        }
        fetch(dmcaUrl, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify(data),
        }).then(res => {
            res.json().then(response => {
                if (response.success) {
                    const successMessage = (form.querySelector(".success") as HTMLElement)
                    // show success message
                    successMessage.style.display = "block"
                    // hide success message after 3 seconds
                    // setTimeout(() => successMessage.style.display = "none", 3000)
                    // or hide entire dialog after 3 seconds
                    timeoutId = setTimeout(() => micromodal.close("dmca"), 3000)
                } else if (response.value == "need captcha" && !captchaScriptLoaded) {
                    const script = document.createElement("script")
                    script.onload = function () {
                        const hCaptcha = (window as any).hcaptcha
                        captchaWidgetId = hCaptcha.render(form.querySelector(".captcha-holder"), {
                            sitekey: globals.captcha_key,
                        })
                        captchaScriptLoaded = true
                        const errorMessage = form.querySelector(".error-captcha") as HTMLDivElement
                        if (errorMessage) {
                            // show error message
                            errorMessage.style.display = "block"
                            // hide the message after 3 seconds
                            // setTimeout(() => errorMessage.style.display = "none", 3000)
                        }
                    }
                    script.src = "https://hcaptcha.com/1/api.js"
                    document.head.appendChild(script)
                } else {
                    const hCaptcha = (window as any).hcaptcha
                    hCaptcha && hCaptcha.reset(captchaWidgetId)
                    if ((response.value as string).includes("captcha")) {
                        const errorMessage = form.querySelector(".error-captcha") as HTMLDivElement
                        if (errorMessage) {
                            // show error message
                            errorMessage.style.display = "block"
                            // hide the message after 3 seconds
                            // setTimeout(() => errorMessage.style.display = "none", 3000)
                        }
                    } else {
                        const errorMessage = form.querySelector(".error-other") as HTMLDivElement
                        if (errorMessage) {
                            errorMessage.innerText = "Error! " + (response.value || "")
                            // show error message
                            errorMessage.style.display = "block"
                            // hide the message after 3 seconds
                            // setTimeout(() => errorMessage.style.display = "none", 3000)
                        }
                    }
                }
            })
        })
    })
    document.querySelectorAll(".dmca-link").forEach(el => {
        el.addEventListener("click", e => {
            e.preventDefault()
            form.querySelectorAll(".error,.success").forEach(el => {
                (el as HTMLDivElement).style.display = "none"
            })
            if (timeoutId) {
                clearTimeout(timeoutId)
                timeoutId = null
            }
            // restoring last email, info, reason
            (form.querySelector("#reason") as HTMLInputElement).value = sessionStorage.getItem("dmca-last-reason") || "copyright";
            (form.querySelector("#info") as HTMLTextAreaElement).value = sessionStorage.getItem("dmca-last-info") || "";
            (form.querySelector("#email") as HTMLInputElement).value = sessionStorage.getItem("dmca-last-email") || "";
            // resetting content_id value
            (form.querySelector("[name=content_id]") as HTMLInputElement).value = ""
            if (captchaScriptLoaded && captchaWidgetId) {
                (window as any).hcaptcha.reset(captchaWidgetId)
            }
            const thumbHolder = el.closest(".thumb")
            const imageHolder = form.querySelector("#image-holder")
            imageHolder.innerHTML = ""
            let thumbUrl = el.getAttribute("data-thumb-url") || ""
            if (thumbUrl == "" && thumbHolder)
                thumbUrl = thumbHolder.querySelector("img").getAttribute("src")
            if (thumbUrl) {
                const img = document.createElement("img")
                img.src = thumbUrl
                imageHolder.appendChild(img)
            }
            const contentIdInput = form.querySelector("[name=content_id]") as HTMLInputElement
            let contentId = el.getAttribute("data-id")
            if (contentId) {
                contentIdInput.value = contentId
            } else if (thumbHolder) {
                const anchor = thumbHolder.querySelector("a[data-id]")
                if (anchor) {
                    const contentId = anchor.getAttribute("data-id")
                    contentIdInput.value = contentId || ""
                }
            }
            micromodal.show("dmca")
        })
    })
    // Unified thumb preview system (video preview + thumb rotation)
    let currentlyPreloadingImage: HTMLImageElement | null = null
    let activeVideoElement: HTMLVideoElement | null = null
    let activeThumbRotation: {
        element: Element
        timeoutId: number | null
        currentThumbNumber: number
        origThumbNumber: number
        srcTemplate: string
        isRetina: boolean
        thumbsAmount: number
        sourceElement: HTMLSourceElement
        imgElement: HTMLImageElement
    } | null = null

    // Helper functions
    const stopAllPreviews = () => {
        // Stop active video preview
        if (activeVideoElement) {
            activeVideoElement.pause()
            activeVideoElement.currentTime = 0
            const pictureEl = activeVideoElement.parentNode as HTMLElement
            if (pictureEl) {
                const imgEl = pictureEl.querySelector("img")
                if (imgEl) imgEl.style.opacity = "1"
                if (activeVideoElement.parentNode === pictureEl) {
                    pictureEl.removeChild(activeVideoElement)
                }
            }
            activeVideoElement = null
        }

        // Stop active thumb rotation
        if (activeThumbRotation) {
            if (activeThumbRotation.timeoutId) {
                clearTimeout(activeThumbRotation.timeoutId)
                activeThumbRotation.timeoutId = null
            }
            // Restore original thumb
            const origSrc = activeThumbRotation.srcTemplate.replace("%d", activeThumbRotation.origThumbNumber.toString())
            activeThumbRotation.imgElement.src = origSrc
            activeThumbRotation.sourceElement.srcset = activeThumbRotation.isRetina ?
                origSrc + ", " + origSrc.replace(/\.(jpg|webp|png)$/, "@2x.$1") + " 1.5x" : origSrc
            activeThumbRotation = null
        }
    }

    const createVideoElement = (previewUrl: string): HTMLVideoElement => {
        const videoEl = document.createElement("video")
        videoEl.src = previewUrl
        videoEl.muted = true
        videoEl.loop = true
        videoEl.playsInline = true
        videoEl.preload = "metadata"
        videoEl.style.width = "100%"
        videoEl.style.height = "100%"
        videoEl.style.objectFit = "cover"
        videoEl.style.position = "absolute"
        videoEl.style.top = "0"
        videoEl.style.left = "0"
        videoEl.style.zIndex = "1"
        return videoEl
    }

    const startVideoPreview = (thumbLink: Element) => {
        const previewUrl = thumbLink.getAttribute("data-preview")
        if (!previewUrl) return false

        const pictureEl = thumbLink.querySelector("picture")
        const imgEl = pictureEl?.querySelector("img") as HTMLImageElement
        if (!imgEl || !pictureEl) return false

        const videoEl = createVideoElement(previewUrl)
        activeVideoElement = videoEl

        pictureEl.style.position = "relative"
        pictureEl.appendChild(videoEl)
        imgEl.style.opacity = "0"

        videoEl.play().catch(() => {
            // Autoplay failed, but video is loaded
        })

        return true
    }

    const startThumbRotation = (pictureEl: Element) => {
        const thumbsAmount = parseInt(pictureEl.getAttribute("data-amount") || "0")
        if (thumbsAmount <= 1) return false

        const origThumbNumber = parseInt(pictureEl.getAttribute("data-thumb-number") || "0")
        const sourceElement = pictureEl.querySelector("source") as HTMLSourceElement
        const imgElement = pictureEl.querySelector("img") as HTMLImageElement
        const srcTemplate = imgElement.src.replace(/\.(\d+)\.(webp|jpg|png)$/, ".%d.$2")
        const isRetina = sourceElement.srcset.includes("@2x.")

        let currentThumbNumber = origThumbNumber
        let timeoutId: number | null = null

        activeThumbRotation = {
            element: pictureEl,
            timeoutId,
            currentThumbNumber,
            origThumbNumber,
            srcTemplate,
            isRetina,
            thumbsAmount,
            sourceElement,
            imgElement
        }

        const preloadAndRotate = () => {
            currentlyPreloadingImage = document.createElement("img")
            let newThumbNumber = currentThumbNumber + 1
            if (newThumbNumber >= thumbsAmount) newThumbNumber = 0
            const newSrc = srcTemplate.replace("%d", newThumbNumber.toString())
            currentlyPreloadingImage.setAttribute("src", newSrc)
            let loaded = false
            currentlyPreloadingImage.addEventListener("load", () => loaded = true)
            const doRotate = () => {
                if (!loaded) {
                    timeoutId = window.setTimeout(doRotate, 200)
                    return
                }
                if (activeThumbRotation && activeThumbRotation.element === pictureEl) {
                    imgElement.src = newSrc
                    sourceElement.srcset = isRetina ? newSrc + ", " + newSrc.replace(/\.(jpg|webp|png)$/, "@2x.$1") + " 1.5x" : newSrc
                    currentThumbNumber++
                    if (currentThumbNumber >= thumbsAmount) currentThumbNumber = 0
                    activeThumbRotation.currentThumbNumber = currentThumbNumber
                    activeThumbRotation.timeoutId = window.setTimeout(preloadAndRotate, globals.thumb_rotate_delay)
                }
            }
            timeoutId = window.setTimeout(doRotate, globals.thumb_rotate_delay)
            if (activeThumbRotation) {
                activeThumbRotation.timeoutId = timeoutId
            }
        }
        preloadAndRotate()

        return true
    }

    // Event delegation on .thumbs container
    document.querySelectorAll(".thumbs").forEach(thumbsContainer => {
        let currentHoveredThumb: Element | null = null

        const handleThumbHover = (thumb: Element) => {
            if (thumb === currentHoveredThumb) return

            currentHoveredThumb = thumb
            stopAllPreviews()

            const thumbLink = thumb.querySelector("a.thumb-link") as Element
            if (!thumbLink) return

            // Priority: video preview first, then thumb rotation
            const hasVideoPreview = startVideoPreview(thumbLink)
            if (!hasVideoPreview) {
                const pictureEl = thumb.querySelector("picture[data-thumb-number]")
                if (pictureEl) {
                    startThumbRotation(pictureEl)
                }
            }
        }

        const handleMouseLeave = (e: MouseEvent) => {
            const target = e.target as Element
            const thumb = target.closest(".thumb") as Element
            const relatedThumb = e.relatedTarget ? (e.relatedTarget as Element).closest(".thumb") : null

            // Only stop if we're actually leaving the thumbs container entirely
            if (thumb && !relatedThumb) {
                currentHoveredThumb = null
                stopAllPreviews()
            }
        }

        // Handle mouseover on thumbs container (triggers for any thumb hover)
        thumbsContainer.addEventListener("mouseover", (e: Event) => {
            const target = e.target as Element
            const thumb = target.closest(".thumb") as Element
            if (thumb) {
                handleThumbHover(thumb)
            }
        })

        thumbsContainer.addEventListener("mouseleave", handleMouseLeave, true)

        // Mobile touch and scroll handling
        let touchStartThumb: Element | null = null

        const handleTouchStart = (e: TouchEvent) => {
            const target = e.target as Element
            const thumb = target.closest(".thumb") as Element
            if (!thumb) return

            e.preventDefault()
            touchStartThumb = thumb
            stopAllPreviews()

            const thumbLink = thumb.querySelector("a.thumb-link") as Element
            if (thumbLink) {
                const hasVideoPreview = startVideoPreview(thumbLink)
                if (!hasVideoPreview) {
                    const pictureEl = thumb.querySelector("picture[data-thumb-number]")
                    if (pictureEl) {
                        startThumbRotation(pictureEl)
                    }
                }
            }
        }

        const handleTouchEnd = () => {
            if (touchStartThumb) {
                stopAllPreviews()
                touchStartThumb = null
            }
        }

        thumbsContainer.addEventListener("touchstart", handleTouchStart, { passive: false })
        thumbsContainer.addEventListener("touchend", handleTouchEnd)

        // Intersection Observer for scroll-based preview on mobile
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (window.innerWidth > 768) return // Only on mobile

                const thumb = entry.target.closest(".thumb") as Element
                if (!thumb) return

                if (entry.isIntersecting) {
                    // Only start preview if not already active and no touch in progress
                    if (!activeVideoElement && !activeThumbRotation && !touchStartThumb) {
                        const thumbLink = thumb.querySelector("a.thumb-link") as Element
                        if (thumbLink) {
                            const hasVideoPreview = startVideoPreview(thumbLink)
                            if (!hasVideoPreview) {
                                const pictureEl = thumb.querySelector("picture[data-thumb-number]")
                                if (pictureEl) {
                                    startThumbRotation(pictureEl)
                                }
                            }
                        }
                    }
                } else {
                    // Stop preview only if it's for this thumb
                    if ((activeVideoElement && activeVideoElement.closest(".thumb") === thumb) ||
                        (activeThumbRotation && activeThumbRotation.element.closest(".thumb") === thumb)) {
                        stopAllPreviews()
                    }
                }
            })
        }, {
            threshold: 0.5,
            rootMargin: '50px'
        })

        // Observe all thumbs in this container
        thumbsContainer.querySelectorAll(".thumb").forEach(thumb => {
            observer.observe(thumb)
        })
    })
    // scroll to top functionality
    const backToTopBtn = document.querySelector("#back-to-top") as HTMLElement
    window.onscroll = () => {
        if (document.body.scrollTop > 200 || document.documentElement.scrollTop > 200) {
            backToTopBtn.style.display = "block"
        } else {
            backToTopBtn.style.display = "none"
        }
    }
    backToTopBtn.addEventListener("click", e => {
        e.preventDefault()
        document.body.scrollTop = 0 // For Safari
        document.documentElement.scrollTop = 0 // For Chrome, Firefox, IE and Opera
    })
})