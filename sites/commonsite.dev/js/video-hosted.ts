import "plyr/dist/plyr.css"
import Plyr from "plyr"


// Doing everything after html loaded.
document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".video").forEach(video => {
        const videoEl = video.querySelector("video")
        const timeline = videoEl.getAttribute("data-timeline")
        const vastTag = videoEl.getAttribute("data-vast")
        new Plyr(videoEl, {
            ads: {tagUrl: vastTag, enabled: !!vastTag},
            previewThumbnails: {enabled: !!timeline, src: timeline}
        })
    })
})