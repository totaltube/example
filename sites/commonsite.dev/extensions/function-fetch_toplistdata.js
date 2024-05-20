function fetch_toplistdata(amount = 100, toplist_name) {
    if (!amount) amount = 100
    if (global_config.General.Development) {
        // stub for development mode
        const traders = []
        for (let i = 0; i < amount; i++) {
            let domain = faker.DomainName()
            let url = "https://" + domain
            traders.push({domain: domain, name: faker.HipsterSentence(2), url: url})
        }
        return {
            "success": true,
            "out_uri": "/ttt/click",
            "toplist_uri": "/ttt/toplist",
            "tds_uri": "/ttt/tds",
            "hash": md4(Math.random().toString()).slice(0, 12),
            "items": traders.map(function (item) {
                return {
                    trader: {
                        domain: item.domain,
                        name: item.name,
                        url: item.url,
                        niche_urls: [],
                        ratio: 1,
                        max_ratio: 4,
                        max_hour: 0,
                        forces: {
                            free_hour: 0,
                            free_day: 0,
                        },
                        enabled: true,
                        toplist_disabled: false,
                        type: "",
                        with_image: true,
                        root_filter_group_type: "all",
                        filters: [],
                        toplist_data: {
                            // some random thumb
                            thumb: "https://picsum.photos/300/192",
                            hires_thumb: "https://picsum.photos/600/384",
                            // some random title
                            title: faker.HipsterSentence(5),
                            // some random description
                            description: faker.HipsterParagraph(2),
                            content_data: {
                                content_id: faker.RandomNumber(1000000),
                            }
                        }
                    }
                }
            })
        }
    }
    headers["Authorization"] = config.Custom.ttt_secret
    params['hostname'] = host
    params['querystring'] = querystring
    if (!params['headers']) params['headers'] = headers
    params['authorization'] = config.Custom.ttt_secret
    params['with_toplist_data'] = true
    params['sortby'] = 'outlist'
    if (toplist_name) params['name'] = toplist_name
    var out = fetch("http://127.0.0.1:8399/_toplist").WithMethod("POST").WithJsonData(params)
    if (out) {
        if (params['toplist_name']) return out.String()
        var json = out.Json()
        if (json) {
            json.items = json.items.slice(0, amount)
            return json
        }
        console.log("Can't get toplist:", json)
        return null
    }
    console.log("can't get toplist", out)
    return null
}