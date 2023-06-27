// Function to add random content to existing to fill to specified amount
function populate_with_random(items, amount) {
    if (items.length >= amount) {
        return items
    }
    var out = fetch("content").WithQueryParam("sort", "rand1").Json()
    if (out) {
        return items.concat(out.items)
    }
    return items
}
