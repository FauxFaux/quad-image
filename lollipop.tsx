import * as JSONAPI from 'jsonapi-typescript';

let quadpees: string[] = [];
let targetGallery: string | null = null;

const images = document.getElementById('images') as HTMLElement;
const form = document.getElementById('form') as HTMLElement;

class Item {
  actionButton: HTMLElement;
  binButton: HTMLElement;
  li: HTMLLIElement;

  constructor(isLoading: boolean) {
    this.li = document.createElement('li');
    images.insertBefore(this.li, images.firstChild);
    if (isLoading) {
      this.li.classList.add('loading');
    }

    this.actionButton = document.createElement('button');
    this.actionButton.className = 'action';
    this.li.appendChild(this.actionButton);

    this.binButton = document.createElement('button');
    this.binButton.className = 'bin';
    this.li.appendChild(this.binButton);
  }
}

function upload(fileBlob: Blob, cb: (success: boolean, msg: string) => void) {
  const data = new FormData();
  data.append('image', fileBlob);
  data.append('return_json', 'true');
  fetch('/api/upload', {
    method: 'POST',
    data,
    processData: false,
    contentType: false,
    success: (resp: JSONAPI.Document) => {
      if ('data' in resp) {
        const doc = resp as JSONAPI.DocWithData<JSONAPI.ResourceObject>;
        const url = doc.data.id;
        if (!url) {
          cb(false, 'empty id returned');
          return;
        }
        if (targetGallery) {
          addImagesToGallery(targetGallery, [url]);
        }
        quadpees.push(url);
        localStorage.setItem('quadpees', JSON.stringify(quadpees));
        cb(true, url);
      } else if ('errors' in resp) {
        const doc = resp;
        cb(false, doc.errors.join(', '));
      } else {
        cb(false, `unexpected object ${Object.keys(resp).join(', ')}`);
      }
    },
    error: (xhr, status, errorThrown) => {
      cb(false, `upload request failed: ${status} - ${errorThrown}`);
    },
  });
}

function makeLoadedItem(loadingItem: Item, url: string) {
  const a = document.createElement('a');
  const img = document.createElement('img');

  a.href = url;
  a.target = '_blank';

  const copyInput = document.createElement('input');
  copyInput.value = a.href;

  const label = 'copy';
  loadingItem.actionButton.innerHTML = label;
  loadingItem.actionButton.onclick = (e) => {
    e.preventDefault();
    copyInput.select();
    document.execCommand('Copy');
    loadingItem.actionButton.innerHTML = 'copied';
  };
  loadingItem.actionButton.onmouseleave = () => {
    loadingItem.actionButton.innerHTML = label;
  };

  loadingItem.binButton.innerHTML = '🗑➡️';
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

    localStorage.setItem('quadpees', JSON.stringify(quadpees));
  };

  a.appendChild(img);
  loadingItem.li.appendChild(a);
  loadingItem.li.appendChild(copyInput);
  loadingItem.li.dataset.miniUrl = url;

  img.onload = () => {
    loadingItem.li.classList.remove('loading');
    loadingItem.li.classList.add('loaded');
  };

  img.src = url + '.thumb.jpg';
}

function process(file: File) {
  setBodyActive();

  const reader = new FileReader();
  reader.onload = function () {
    if (!this.result) {
      error('file api acted unexpectedly, not sure why');
      return;
    }

    const type = file.type || 'image/jpeg';

    const blob = new Blob([this.result], { type });

    const loadingItem = new Item(true);

    upload(blob, (success, msg) => {
      if (!success) {
        loadingItem.actionButton.onclick = () => {
          alert(msg);
        };
        loadingItem.li.classList.add('failed');
        loadingItem.li.classList.remove('loading');
        return;
      }

      makeLoadedItem(loadingItem, msg);
    });
  };

  reader.readAsArrayBuffer(file);
}

function setBodyActive() {
  document.body.classList.add('active-upload');
}

function onFiles(items: FileList | null, context: string) {
  if (!items) {
    error('Files not set; nothing to do.');
    return;
  }

  if (0 === items.length) {
    error(
      `No files, valid or not, were found in your ${context}. Maybe it wasn't a valid image, or your browser is confused about what it was?`
    );
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
      error("Ignoring non-image item (of type '" + item.type + "') in " + context + ': ' + item.name);
    }
  }

  form.classList.remove('dragover');
}

function error(msg: string) {
  const errors = document.getElementById('errors') as HTMLElement;
  errors.style.display = 'block';
  const span = document.createElement('p');
  span.innerHTML = msg;
  errors.insertBefore(span, errors.firstChild);
}

function callGallery(gallery: string, images: string[]) {
  return $.ajax('/api/gallery', {
    type: 'PUT',
    contentType: 'application/json',
    data: JSON.stringify({
      data: {
        type: 'gallery',
        attributes: {
          gallery,
          images,
        },
      },
    }),
  });
}

function setCurrentPublic(id: string) {
  $('#current-gallery')
    .empty()
    .append(
      $('<a>')
        .attr('href', '/gallery/#' + id)
        .attr('target', 'none')
        .text(id)
    );
}

function addImagesToGallery(gallery: string, images: string[]) {
  callGallery(gallery, images)
    .then(function (resp) {
      if ('errors' in resp) {
        resp.errors.forEach((e: JSONAPI.ErrorObject) => error(`then: ${e.code}: ${e.title}`));
      } else if ('data' in resp) {
        if ('gallery' !== resp.data.type) {
          error('invalid response type');
        } else {
          setCurrentPublic(resp.data.id);
          $('#new-gallery').val('');
          localStorage.setItem('gallery', gallery);
          targetGallery = gallery;
        }
      } else {
        error('invalid response object: ' + JSON.stringify(resp));
      }
    })
    .catch((xhr: any) => {
      if (xhr.responseJSON && 'errors' in xhr.responseJSON) {
        xhr.responseJSON.errors.forEach((e: JSONAPI.ErrorObject) => error(`http: ${e.code}: ${e.title}`));
      }
    });
}

function loadStorage() {
  const storage: string | null = localStorage.getItem('quadpees');
  if (storage) {
    quadpees = JSON.parse(storage);
    setBodyActive();
    quadpees.forEach((pee) => {
      makeLoadedItem(new Item(false), pee);
    });
  } else {
    localStorage.setItem('quadpees', '[]');
  }

  targetGallery = localStorage.getItem('gallery');
}

function setEvents() {
  const doc = document.documentElement;
  const realos = document.getElementById('realos') as HTMLInputElement;

  realos.onchange = () => {
    onFiles(realos.files, 'picked files');
  };

  doc.onpaste = (e) => {
    e.preventDefault();
    onFiles(e.clipboardData && e.clipboardData.files, 'pasted content');
  };

  doc.ondrop = (e) => {
    e.preventDefault();
    form.classList.remove('dragover');
    if (e.dataTransfer) {
      onFiles(e.dataTransfer.files, 'dropped objects');
    } else {
      error("Something was dropped, but it didn't have anything inside.");
    }
  };

  doc.ondragenter = (e) => {
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    e.preventDefault();
  };

  doc.ondragover = (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    form.classList.add('dragover');
  };

  (doc as any).ondragexit = doc.ondragleave = () => {
    form.classList.remove('dragover');
  };

  $('#user-button').on('click', () => {
    $('#user-button').hide();
    $('#user-settings').show();
    if (targetGallery) {
      addImagesToGallery(targetGallery, []);
    } else {
      $('#current-gallery').empty().html('<i>not set</i>');
    }
  });

  $('#user-settings .close').on('click', () => {
    $('#user-button').show();
    $('#user-settings').hide();
  });

  $('#user-form').submit(() => {
    addImagesToGallery($('#new-gallery').val() as string, quadpees);
    return false;
  });

  const errors = document.getElementById('errors') as HTMLElement;
  errors.style.display = 'none';
  errors.innerHTML = '';
}

export function init() {
  $(loadStorage);
  $(setEvents);
}
