
// Doing everything after html loaded.
document.addEventListener("DOMContentLoaded", function () {
    // Video page js
    document.querySelectorAll(".video").forEach(video => {
        const video_id = video.getAttribute("data-id")
        const video_type = video.getAttribute("data-type")
        const under_url = video.getAttribute("data-under-url")
        const insert = video.querySelector(".insert") as HTMLElement
        if (video_type === "video-link" || (localStorage.getItem("vclose") !== video_id)) {
            insert.style.display = "block"
        }
        insert.querySelectorAll("a").forEach(anchor => {
            anchor.addEventListener("click", () => {
                localStorage.setItem("vclose", video_id)
                if (navigator.userAgent.toLowerCase().indexOf('ucbrowser/') >= 0) {
                    return
                }
                const targetWindowName = "video-site-" + Math.random().toString()
                try {
                    const w = window.open("", targetWindowName)
                    if (w) {
                        anchor.target = targetWindowName
                        if (navigator.userAgent.match(/Firefox/i)) {
                            anchor.rel = ""
                        }
                        setTimeout(() => {
                            window.location.href = under_url
                        }, 10)
                        return
                    }
                } catch (err) {
                }
            })
        })
    })
})