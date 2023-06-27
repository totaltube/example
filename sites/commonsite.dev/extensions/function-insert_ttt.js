function insert_ttt() {
    if (global_config.General.Development) {
        set_cookie("ttt", "18nmsx9", new Date(new Date().getTime() + 86400000))
        set_var("ttt", {
            "counted": true,
            "from": {
                "domain": "somesite.com",
                "type": "trade"
            }
        })
        return "<script>console.log('Stub for ttt script')</script>"
    }
    var out = fetch("http://127.0.0.1:8399/_in").WithMethod("POST").WithJsonData({
        hostname: host,
        querystring: querystring,
        headers: headers,
        authorization: config.Custom.ttt_secret
    }).Json()
    if (out) {
        set_var("ttt", out)
        set_cookie(out.sessionName, out.sessionId, new Date(out.sessionExpire))
        return "<script>" + out.script + "</script>"
    } else {
        console.log("can't insert ttt in:", out)
    }
    return ""
}