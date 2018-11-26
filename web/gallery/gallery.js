"use strict";
var Gallery;
(function (Gallery) {
    var state = null;
    var State = (function () {
        function State(gallery, images) {
            this.gallery = gallery;
            this.images = images;
        }
        return State;
    }());
    var Hash = (function () {
        function Hash() {
            var hash = window.location.hash || "#";
            var parts = hash.split("#");
            if (parts.length < 2) {
                throw new Error("no gallery provided");
            }
            this.gallery = parts[1];
            if (parts.length > 1) {
                this.after = parts[2];
            }
            else {
                this.after = null;
            }
        }
        return Hash;
    }());
    function hashChanged() {
        var target = document.getElementById("gallery");
        if (null == target) {
            console.log("script mis-loaded?");
            return;
        }
        var showError = function (msg) { return target.innerText = msg; };
        var hash = new Hash();
        if (state && state.gallery === hash.gallery) {
            render(target, hash);
            return;
        }
        state = null;
        $.get("../api/gallery/" + hash.gallery)
            .done(function (data) {
            var images = fetch_complete(data, showError);
            if (null === images) {
                return;
            }
            state = new State(hash.gallery, images);
            render(target, hash);
        })
            .catch(function () { return showError("network error fetching gallery"); });
    }
    Gallery.hashChanged = hashChanged;
    function fetch_complete(resp, showError) {
        if ("errors" in resp) {
            showError(JSON.stringify(resp.errors));
            return null;
        }
        if (!("data" in resp) || !Array.isArray(resp.data)) {
            showError(JSON.stringify(resp));
            return null;
        }
        var withData = resp;
        return imageIds(withData.data);
    }
    function imageIds(withData) {
        var ids = [];
        for (var _i = 0, withData_1 = withData; _i < withData_1.length; _i++) {
            var img = withData_1[_i];
            if ("image" !== img.type || undefined === img.id) {
                console.log("invalid record", img);
                continue;
            }
            ids.push(img.id);
        }
        return ids;
    }
    function render(body, hash) {
        body.innerText = "";
        if (null == state) {
            console.log("impossible state");
            return;
        }
        var itemsPerPage = 10;
        var images = state.images;
        var currentImage = 0;
        if (null !== hash.after) {
            var afterIdx = images.indexOf(hash.after);
            if (-1 !== afterIdx) {
                currentImage = afterIdx + 1;
            }
        }
        var thisPage = images.slice(currentImage, Math.min(currentImage + itemsPerPage, images.length));
        for (var _i = 0, thisPage_1 = thisPage; _i < thisPage_1.length; _i++) {
            var id = thisPage_1[_i];
            var tag = $("<img/>", {
                src: "../" + id,
            }).appendTo(body);
            $("<hr/>").appendTo(body);
        }
        var pages = Math.ceil(images.length / itemsPerPage);
        var currentPage = Math.floor(currentImage / itemsPerPage);
        for (var page = 0; page < pages; ++page) {
            var active = page === currentPage;
            $("<a/>", {
                href: "#" + hash.gallery + "#" + images[page * itemsPerPage],
            })
                .addClass(active ? "active" : "inactive")
                .append("" + (page + 1))
                .appendTo(body);
        }
    }
})(Gallery || (Gallery = {}));
window.onhashchange = Gallery.hashChanged;
var module;
if (undefined === module) {
    module = {};
}
module.exports = 0;
