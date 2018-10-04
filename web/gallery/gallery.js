"use strict";
exports.__esModule = true;
function load(body) {
    var hash = window.location.hash || "#";
    var parts = hash.split("#");
    var gallery = parts[1];
    var after;
    if (parts.length > 1) {
        after = parts[2];
    }
    else {
        after = null;
    }
    $.get("../api/gallery/" + gallery)
        .done(function (data) { return fetch_complete(body, data, gallery, after); })["catch"](function () {
        body.innerText = "network error fetching gallery";
    });
}
function fetch_complete(body, resp, gallery, after) {
    if ("errors" in resp) {
        body.innerText = JSON.stringify(resp.errors);
        return;
    }
    if (!("data" in resp) || !Array.isArray(resp.data)) {
        body.innerText = JSON.stringify(resp);
    }
    // TYPE CHECKER
    var withData = resp;
    body.innerText = "";
    var ids = [];
    for (var _i = 0, _a = withData.data; _i < _a.length; _i++) {
        var img = _a[_i];
        if ("image" !== img.type) {
            body.innerText = "Invalid object in response";
            return;
        }
        ids.push(img.id);
    }
    var start = 0;
    if (after) {
        var afterIdx = ids.indexOf(after);
        if (-1 !== afterIdx) {
            start = afterIdx + 1;
        }
    }
    ids = ids.slice(start);
    var more = ids.length > 10;
    ids = ids.slice(0, Math.min(10, ids.length));
    for (var _b = 0, ids_1 = ids; _b < ids_1.length; _b++) {
        var id = ids_1[_b];
        var tag = document.createElement("img");
        tag.src = "../" + id;
        body.appendChild(tag);
        body.appendChild(document.createElement("hr"));
    }
    if (ids.length && more) {
        var last = ids[ids.length - 1];
        var next = document.createElement("a");
        next.href = "#" + gallery + "#" + last;
        next.innerText = "Next page";
        body.appendChild(next);
    }
}
