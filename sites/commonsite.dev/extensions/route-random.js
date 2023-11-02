// Function must return cache key, it may be based on some params or querystring
// path params are available in var "params" and query params in var "query"
function cacheKey() {
    const p = query['page'] || 1
    return `niche-${p}-${lang.Id}`
}

// function must return cache ttl in seconds
function cacheTtl() {
    return 5
}

// function prepare will return object with vars which will be available in templates
function prepare() {
    let p = page
    if (p <= 1) p = 1
    const content = get_content("sort", "rand", "amount", 5, "page", p)
    const category = get_category("category_slug", "red")
    return {
        "category": category,
        "count": true,
        "content": content,
        "total": content.Total,
        "from": content.From,
        "to": content.To,
        "page": content.Page,
        "pages": content.Pages
    }
}

// function which will render the template. It can return string as rendered template or object as json.
// If function returns anything else or nothing - it will not be used to render. Instead custom template will be used.
// Function also can return function redirect() with param url and optional param code (301 or 302) to redirect to given url
function render() {
}
