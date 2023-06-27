// Function must return cache key, it may be based on some params or querystring
// path params are available in var "params" and query params in var "query"
function cacheKey() {
    return ""
}

// function must return cache ttl in seconds
function cacheTtl() {
    return 0
}
// function prepare will return object with vars which will be available in templates
function prepare() {
}

// function which will render the template. It can return string as rendered template or object as json.
// If function returns anything else or nothing - it will not be used to render. Instead custom template will be used.
// Function also can return function redirect() with param url and optional param code (301 or 302) to redirect to given url
function render() {
}