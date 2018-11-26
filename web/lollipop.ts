import * as $ from "jquery";
import * as JSONAPI from "jsonapi-typescript";

namespace Lollipop {
    let quadpees: string[] = [];

    const images = document.getElementById("images") as HTMLElement;
    const form = document.getElementById("form") as HTMLElement;

    class Item {
        actionButton: HTMLElement;
        binButton: HTMLElement;
        li: HTMLLIElement;

        constructor(isLoading: boolean) {
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
    }

    function upload(fileBlob: Blob, cb: (success: boolean, msg: string) => void) {
        $.ajax("/api/upload", {
            method: "POST",
            data: {
                image: fileBlob,
                return_json: true,
            },
            success: (resp: JSONAPI.Document) => {
                const url = resp.data.id;
                quadpees.push(url);
                localStorage.setItem("quadpees", JSON.stringify(quadpees));
                cb(true, url);
            },
            error: (xhr, thrown, text) => {
                cb(false, xhr.responseText || "Error.");
            },
        });
    }

    function makeLoadedItem(loadingItem: Item, url: string) {

        const a = document.createElement("a");
        const img = document.createElement("img");

        a.href = url;
        a.target = "_blank";

        const copyInput = document.createElement("input");
        copyInput.value = a.href;

        const label = "copy";
        loadingItem.actionButton.innerHTML = label;
        loadingItem.actionButton.onclick = (e) => {
            e.preventDefault();
            copyInput.select();
            document.execCommand("Copy");
            loadingItem.actionButton.innerHTML = "copied";
        };
        loadingItem.actionButton.onmouseleave = () => {
            loadingItem.actionButton.innerHTML = label;
        };

        loadingItem.binButton.innerHTML = "🗑➡️";
        loadingItem.binButton.onclick = (e) => {
            e.preventDefault();
            let removing = false;
            Array.prototype.slice.call(images.childNodes).forEach((i: HTMLElement) => {
                if (url === i.dataset.miniUrl) {
                    removing = true;
                }
                if (removing) {
                    images.removeChild(i);
                    const idx = quadpees.indexOf(i.dataset.miniUrl);
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

        img.onload = () => {
            loadingItem.li.classList.remove("loading");
            loadingItem.li.classList.add("loaded");
        };

        img.src = a.href;
    }

    function process(file: File) {

        setBodyActive();

        const reader = new FileReader();
        reader.onload = (e) => {
            const blob = new Blob([e.target.result], {type: "image/jpeg"});

            const loadingItem = new Item(true);

            upload(blob, (err, msg) => {

                if (err) {
                    loadingItem.actionButton.onclick = () => {
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

    function onFiles(items: FileList | null, context: string) {
        if (!items) {
            error("Files not set; nothing to do.");
            return;
        }

        if (0 === items.length) {
            error("No files, valid or not, were found in your " + context
                + ". Maybe it wasn't a valid image, or your browser is confused about what it was?");
            return;
        }

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            console.log(item);

            if (item.type.match(/image.*/)) {
                process(item);
            } else {
                error("Ignoring non-image item (of type '" + item.type + "') in " + context + ": " + item.name);
            }
        }

        form.classList.remove("dragover");
    }

    function error(msg: string) {
        const errors = document.getElementById("errors") as HTMLElement;
        errors.style.display = "block";
        const span = document.createElement("p");
        span.innerHTML = msg;
        errors.insertBefore(span, errors.firstChild);
    }

    $(() => {
        const storage: string | null = localStorage.getItem("quadpees");
        if (storage) {
            quadpees = JSON.parse(storage);
            setBodyActive();
            quadpees.forEach((pee) => {
                makeLoadedItem(new Item(false), pee);
            });
        } else {
            localStorage.setItem("quadpees", "[]");
        }
    });

    $(() => {
        const doc = document.documentElement as HTMLElement;
        const realos = document.getElementById("realos") as HTMLInputElement;

        realos.onchange = () => {
            onFiles(realos.files, "picked files");
        };

        doc.onpaste = (e) => {
            e.preventDefault();
            onFiles(e.clipboardData.files, "pasted content");
        };

        doc.ondrop = (e) => {
            e.preventDefault();
            form.classList.remove("dragover");
            if (e.dataTransfer) {
                onFiles(e.dataTransfer.files, "dropped objects");
            } else {
                error("Something was dropped, but it didn't have anything inside.");
            }
        };

        doc.ondragenter = (e) => {
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "copy";
            }
            e.preventDefault();
        };

        doc.ondragover = (e) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "copy";
            }
            form.classList.add("dragover");
        };

        doc.ondragexit = doc.ondragleave = () => {
            form.classList.remove("dragover");
        };
    });

}