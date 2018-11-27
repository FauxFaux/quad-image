"use strict";
var Lollipop;
(function (Lollipop) {
    var quadpees = [];
    var images = document.getElementById("images");
    var form = document.getElementById("form");
    var Item = (function () {
        function Item(isLoading) {
            this.li = document.createElement("li");
            images.insertBefore(this.li, images.firstChild);
            if (isLoading) {
                this.li.classList.add("loading");
            }
            this.actionButton = document.createElement("button");
            this.li.appendChild(this.actionButton);
            this.binButton = document.createElement("button");
            this.li.appendChild(this.binButton);
        }
        return Item;
    }());
    function upload(fileBlob, cb) {
        var data = new FormData();
        data.append("image", fileBlob);
        data.append("return_json", "true");
        $.ajax("/api/upload", {
            method: "POST",
            data: data,
            processData: false,
            contentType: false,
            success: function (resp) {
                if ("data" in resp) {
                    var doc = resp;
                    var url = doc.data.id;
                    if (!url) {
                        cb(false, "empty id returned");
                        return;
                    }
                    quadpees.push(url);
                    localStorage.setItem("quadpees", JSON.stringify(quadpees));
                    cb(true, url);
                }
                else if ("errors" in resp) {
                    var doc = resp;
                    cb(false, doc.errors.join(", "));
                }
                else {
                    cb(false, "unexpected object " + Object.keys(resp).join(", "));
                }
            },
            error: function (xhr, status, errorThrown) {
                cb(false, "upload request failed: " + status + " - " + errorThrown);
            },
        });
    }
    function makeLoadedItem(loadingItem, url) {
        var a = document.createElement("a");
        var img = document.createElement("img");
        a.href = url;
        a.target = "_blank";
        var copyInput = document.createElement("input");
        copyInput.value = a.href;
        var label = "copy";
        loadingItem.actionButton.innerHTML = label;
        loadingItem.actionButton.onclick = function (e) {
            e.preventDefault();
            copyInput.select();
            document.execCommand("Copy");
            loadingItem.actionButton.innerHTML = "copied";
        };
        loadingItem.actionButton.onmouseleave = function () {
            loadingItem.actionButton.innerHTML = label;
        };
        loadingItem.binButton.innerHTML = "🗑➡️";
        loadingItem.binButton.onclick = function (e) {
            e.preventDefault();
            var removing = false;
            Array.prototype.slice.call(images.childNodes).forEach(function (i) {
                if (url === i.dataset.miniUrl) {
                    removing = true;
                }
                if (removing) {
                    images.removeChild(i);
                    var idx = quadpees.indexOf(i.dataset.miniUrl);
                    if (idx >= 0) {
                        quadpees.splice(idx, 1);
                    }
                }
            });
            localStorage.setItem("quadpees", JSON.stringify(quadpees));
        };
        a.appendChild(img);
        loadingItem.li.appendChild(a);
        loadingItem.li.appendChild(copyInput);
        loadingItem.li.dataset.miniUrl = url;
        img.onload = function () {
            loadingItem.li.classList.remove("loading");
            loadingItem.li.classList.add("loaded");
        };
        img.src = a.href;
    }
    function process(file) {
        setBodyActive();
        var reader = new FileReader();
        reader.onload = function () {
            if (!this.result) {
                error("file api acted unexpectedly, not sure why");
                return;
            }
            var blob = new Blob([this.result], { type: "image/jpeg" });
            var loadingItem = new Item(true);
            upload(blob, function (success, msg) {
                if (!success) {
                    loadingItem.actionButton.onclick = function () {
                        alert(msg);
                    };
                    loadingItem.li.classList.add("failed");
                    loadingItem.li.classList.remove("loading");
                    return;
                }
                makeLoadedItem(loadingItem, msg);
            });
        };
        reader.readAsArrayBuffer(file);
    }
    function setBodyActive() {
        document.body.classList.add("active-upload");
    }
    function onFiles(items, context) {
        if (!items) {
            error("Files not set; nothing to do.");
            return;
        }
        if (0 === items.length) {
            error("No files, valid or not, were found in your " + context
                + ". Maybe it wasn't a valid image, or your browser is confused about what it was?");
            return;
        }
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            console.log(item);
            if (item.type.match(/image.*/)) {
                process(item);
            }
            else {
                error("Ignoring non-image item (of type '" + item.type + "') in " + context + ": " + item.name);
            }
        }
        form.classList.remove("dragover");
    }
    function error(msg) {
        var errors = document.getElementById("errors");
        errors.style.display = "block";
        var span = document.createElement("p");
        span.innerHTML = msg;
        errors.insertBefore(span, errors.firstChild);
    }
    $(function () {
        var storage = localStorage.getItem("quadpees");
        if (storage) {
            quadpees = JSON.parse(storage);
            setBodyActive();
            quadpees.forEach(function (pee) {
                makeLoadedItem(new Item(false), pee);
            });
        }
        else {
            localStorage.setItem("quadpees", "[]");
        }
    });
    $(function () {
        var doc = document.documentElement;
        var realos = document.getElementById("realos");
        realos.onchange = function () {
            onFiles(realos.files, "picked files");
        };
        doc.onpaste = function (e) {
            e.preventDefault();
            onFiles(e.clipboardData.files, "pasted content");
        };
        doc.ondrop = function (e) {
            e.preventDefault();
            form.classList.remove("dragover");
            if (e.dataTransfer) {
                onFiles(e.dataTransfer.files, "dropped objects");
            }
            else {
                error("Something was dropped, but it didn't have anything inside.");
            }
        };
        doc.ondragenter = function (e) {
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "copy";
            }
            e.preventDefault();
        };
        doc.ondragover = function (e) {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "copy";
            }
            form.classList.add("dragover");
        };
        doc.ondragexit = doc.ondragleave = function () {
            form.classList.remove("dragover");
        };
        var errors = document.getElementById("errors");
        errors.style.display = "none";
        errors.innerHTML = "";
    });
})(Lollipop || (Lollipop = {}));
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
            $("<img/>", {
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
var module;
if (undefined === module) {
    module = {};
}
module.exports = 0;
