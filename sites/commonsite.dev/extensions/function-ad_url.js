// Example function which outputs advertising url depending on zone name

function ad_url(zone, pos) {
    var ret = "https://aa.sersh.com/ds/" + zone + "?d=" + encodeURIComponent(host)
    if (pos) {
        ret += "&pos=" + pos.toString()
    }
    return ret
}