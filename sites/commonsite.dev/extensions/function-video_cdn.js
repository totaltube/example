function video_cdn(url) {
    const u = new URL(url)
    const uri = u.pathname
    const cdn_expired = Math.round(new Date().getTime() / 1000 + 7200).toString()
    const cdn_speed = 131072
    const cdn_buffer = 1000000
    const k = "cdn_expired=" + cdn_expired + ",cdn_speed=" + cdn_speed + ",cdn_buffer=" + cdn_buffer
    const hash = md5(config.Custom.cdn_salt + k + uri).slice(0, 16)
    return u.protocol + "//"+u.host + "/cdn_key=" + hash + "," + k + uri
}