"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var $ = require("jquery");
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
    $.ajax("/api/upload", {
        method: "POST",
        data: {
            image: fileBlob,
            return_json: true,
        },
        success: function (resp) {
            var url = resp.data.id;
            quadpees.push(url);
            localStorage.setItem("quadpees", JSON.stringify(quadpees));
            cb(true, url);
        },
        error: function (xhr, thrown, text) {
            cb(false, xhr.responseText || "Error.");
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
    reader.onload = function (e) {
        var blob = new Blob([e.target.result], { type: "image/jpeg" });
        var loadingItem = new Item(true);
        upload(blob, function (err, msg) {
            if (err) {
                loadingItem.actionButton.onclick = function () {
                    alert(err);
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
});
