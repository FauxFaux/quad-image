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
        const data = new FormData();
        data.append("image", fileBlob);
        data.append("return_json", "true");
        $.ajax("/api/upload", {
            method: "POST",
            data,
            processData: false,
            contentType: false,
            success: (resp: JSONAPI.Document) => {
                if ("data" in resp) {
                    const doc = resp as JSONAPI.DocWithData<JSONAPI.ResourceObject>;
                    const url = doc.data.id;
                    if (!url) {
                        cb(false, "empty id returned");
                        return;
                    }
                    quadpees.push(url);
                    localStorage.setItem("quadpees", JSON.stringify(quadpees));
                    cb(true, url);
                } else if ("errors" in resp) {
                    const doc = resp as JSONAPI.DocWithErrors;
                    cb(false, doc.errors.join(", "));
                } else {
                    cb(false, `unexpected object ${Object.keys(resp).join(", ")}`);
                }
            },
            error: (xhr, status, errorThrown) => {
                cb(false, `upload request failed: ${status} - ${errorThrown}`);
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
                    const idx = quadpees.indexOf(i.dataset.miniUrl as string);
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
        reader.onload = function () {
            if (!this.result) {
                error("file api acted unexpectedly, not sure why");
                return;
            }

            const type = file.type || "image/jpeg";

            const blob = new Blob([this.result], {type});

            const loadingItem = new Item(true);

            upload(blob, (success, msg) => {

                if (!success) {
                    loadingItem.actionButton.onclick = () => {
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

        // FileList isn't iterable
        // tslint:disable-next-line:prefer-for-of
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

        const errors = document.getElementById("errors") as HTMLElement;
        errors.style.display = "none";
        errors.innerHTML = "";
    });
}

namespace Gallery {
    let state: State | null = null;

    class State {
        gallery: string;
        images: string[];

        constructor(gallery: string, images: string[]) {
            this.gallery = gallery;
            this.images = images;
        }
    }

    class Hash {
        gallery: string;
        after: string | null;

        constructor() {
            const hash: string = window.location.hash || "#";

            const parts: string[] = hash.split("#");

            if (parts.length < 2) {
                throw new Error("no gallery provided");
            }

            this.gallery = parts[1];

            if (parts.length > 1) {
                this.after = parts[2];
            } else {
                this.after = null;
            }
        }
    }

    export function hashChanged() {
        const target: null | HTMLElement = document.getElementById("gallery");
        if (null == target) {
            console.log("script mis-loaded?");
            return;
        }

        const showError = (msg: string) => target.innerText = msg;

        // throws on failure
        const hash = new Hash();

        if (state && state.gallery === hash.gallery) {
            render(target, hash);
            return;
        }

        // the data we have saved is useless now
        state = null;

        $.get("../api/gallery/" + hash.gallery)
            .done((data) => {
                const images = fetch_complete(data, showError);
                if (null === images) {
                    return;
                }
                state = new State(hash.gallery, images);
                render(target, hash);
            })
            .catch(() => showError("network error fetching gallery"));
    }

    function fetch_complete(resp: JSONAPI.Document, showError: (msg: string) => void): string[] | null {
        if ("errors" in resp) {
            showError(JSON.stringify(resp.errors));
            return null;
        }

        if (!("data" in resp) || !Array.isArray(resp.data)) {
            showError(JSON.stringify(resp));
            return null;
        }

        const withData = resp as JSONAPI.DocWithData<JSONAPI.ResourceObject[]>;

        return imageIds(withData.data);
    }

    function imageIds(withData: JSONAPI.ResourceObject[]): string[] {
        const ids: string[] = [];

        for (const img of withData) {
            if ("image" !== img.type || undefined === img.id) {
                console.log("invalid record", img);
                continue;
            }

            ids.push(img.id);
        }

        return ids;
    }

    function render(body: HTMLElement, hash: Hash) {
        // clear
        body.innerText = "";

        if (null == state) {
            console.log("impossible state");
            return;
        }

        const itemsPerPage: number = 10;
        const images: string[] = state.images;

        let currentImage = 0;
        if (null !== hash.after) {
            const afterIdx = images.indexOf(hash.after);
            if (-1 !== afterIdx) {
                currentImage = afterIdx + 1;
            }
        }

        const thisPage = images.slice(currentImage, Math.min(currentImage + itemsPerPage, images.length));

        for (const id of thisPage) {
            $("<img/>", {
                src: "../" + id,
            }).appendTo(body);
            $("<hr/>").appendTo(body);
        }

        // 17 images, 10 images per page
        // ceil(0.1) == 1
        // ceil(1.7) == 2
        // ceil(2.0) == 2
        // ceil(2.1) == 3
        // image  0, floor(0.0) == 0
        // image  9, floor(0.9) == 0
        // image 10, floor(1.0) == 1
        // image 12, floor(1.2) == 1

        const pages: number = Math.ceil(images.length / itemsPerPage);
        const currentPage: number = Math.floor(currentImage / itemsPerPage);

        for (let page = 0; page < pages; ++page) {
            const active = page === currentPage;
            $("<a/>", {
                href: `#${hash.gallery}#${images[page * itemsPerPage]}`,
            })
                .addClass(active ? "active" : "inactive")
                .append(`${page + 1}`)
                .appendTo(body);
        }
    }
}

// working around tsc's complete and utter inability to
// produce browser-safe ES5 to save its life
export = 0;
let module: any;
if (undefined === module) {
    module = {};
}
