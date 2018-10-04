import * as JSONAPI from "jsonapi-typescript";

function load(body: HTMLElement) {
    const hash = window.location.hash || "#";

    const parts = hash.split("#");

    const gallery = parts[1];
    let after: string | null;

    if (parts.length > 1) {
        after = parts[2];
    } else {
        after = null;
    }

    $.get("../api/gallery/" + gallery)
        .done((data) => fetch_complete(body, data, gallery, after))
        .catch(() => {
            body.innerText = "network error fetching gallery";

        });
}

function fetch_complete(body: HTMLElement, resp: JSONAPI.Document, gallery: string, after: string | null) {
    if ("errors" in resp) {
        body.innerText = JSON.stringify(resp.errors);
        return;
    }

    if (!("data" in resp) || !Array.isArray(resp.data)) {
        body.innerText = JSON.stringify(resp);
    }

    // TYPE CHECKER
    const withData = resp as JSONAPI.DocWithData<JSONAPI.ResourceObject[]>;

    body.innerText = "";
    let ids = [];

    for (const img of withData.data) {
        if ("image" !== img.type) {
            body.innerText = "Invalid object in response";
            return;
        }

        ids.push(img.id);
    }

    let start = 0;
    if (after) {
        const afterIdx = ids.indexOf(after);
        if (-1 !== afterIdx) {
            start = afterIdx + 1;
        }
    }

    ids = ids.slice(start);
    const more = ids.length > 10;
    ids = ids.slice(0, Math.min(10, ids.length));

    for (const id of ids) {
        const tag = document.createElement("img");
        tag.src = "../" + id;
        body.appendChild(tag);
        body.appendChild(document.createElement("hr"));
    }

    if (ids.length && more) {
        const last = ids[ids.length - 1];
        const next = document.createElement("a");
        next.href = "#" + gallery + "#" + last;
        next.innerText = "Next page";
        body.appendChild(next);
    }
}
