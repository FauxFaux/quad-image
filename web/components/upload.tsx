import { Component, createRef } from 'preact';
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';

interface Printer {
  warn: (msg: string) => void;
  error: (err: Error | unknown) => void;
}

interface UploadProps {
  printer: Printer;
  triggerUploads: (files: Blob[], ctx: string) => void;
}

function acceptableMime(mime: string) {
  return mime.startsWith('image/');
}

type UploadContext = 'dropped' | 'picked' | 'pasted';

export class Upload extends Component<UploadProps, unknown> {
  readonly refPickFiles = createRef<HTMLInputElement>();

  onFiles = (rawFileList: FileList | undefined | null, ctx: UploadContext) => {
    const fileList: File[] = Array.from(rawFileList || []);
    const uploads: Blob[] = [];

    for (const file of fileList) {
      if (!acceptableMime(file.type)) {
        this.props.printer.warn(
          `Unsupported non-image item ${ctx}: ${file.name} - ${file.type}`,
        );
        continue;
      }
      uploads.push(file);
    }
    if (!uploads.length) {
      this.props.printer.warn(`No images ${ctx}, nothing to upload.`);
      return;
    }
    this.props.triggerUploads(uploads, ctx);
  };

  onDrop = (ev: DragEvent) => {
    ev.preventDefault();
    this.onFiles(ev.dataTransfer?.files, 'dropped');
  };

  onFilePicker = () => {
    this.onFiles(this.refPickFiles.current?.files, 'picked');
    const rpf = this.refPickFiles.current;
    if (rpf) rpf.value = '';
  };

  onPasteDocument = (ev: ClipboardEvent) => {
    if (document.activeElement?.tagName === 'INPUT') return;
    ev.preventDefault();
    this.onFiles(ev.clipboardData?.files, 'pasted');
  };

  onPasteButtonClick = async () => {
    try {
      const uploads: Blob[] = [];
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const images = item.types.filter((type) => type.startsWith('image/'));
        if (!images.length) {
          const typeList = item.types.join(', ');
          this.props.printer.warn(
            `Unsupported non-image item in clipboard, only found ${typeList}.`,
          );
          continue;
        }
        const type = preferredCodec(images);
        const blob = await item.getType(type);
        uploads.push(blob);
      }
      if (!uploads.length) {
        this.props.printer.warn('No images in clipboard, nothing to upload.');
        return;
      }
      this.props.triggerUploads(uploads, 'pasted');
    } catch (err) {
      this.props.printer.error(err);
    }
  };

  dropClick = () => {
    this.refPickFiles.current?.click();
  };

  render() {
    const setCanDrop = (ev: JSX.TargetedDragEvent<HTMLDivElement>) => {
      ev.preventDefault();
      if (ev.dataTransfer) {
        ev.dataTransfer.dropEffect = 'copy';
      }
    };

    useEffect(() => {
      const handle = (ev: ClipboardEvent) => this.onPasteDocument(ev);
      document.addEventListener('paste', handle);
      return () => document.removeEventListener('paste', handle);
    }, []);

    return (
      <div class={'container-fluid'}>
        <div class={'row'}>
          <div
            class={'col home--upload_drop'}
            onDrop={this.onDrop}
            onDragEnter={setCanDrop}
            onDragOver={setCanDrop}
            onClick={this.dropClick}
          >
            <span>drop, click, tap, or paste</span>
          </div>
        </div>
        <div class={'row'}>
          <div class={'col-9 home--upload_pick'}>
            <input
              class={'form-control'}
              type={'file'}
              ref={this.refPickFiles}
              multiple={true}
              accept={'image/*'}
              onInput={this.onFilePicker}
            />
          </div>
          <div class={'col-3 home--upload_paste'}>
            <button
              class={'btn btn-secondary home--upload_button'}
              onClick={this.onPasteButtonClick}
            >
              paste
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function preferredCodec(mimes: string[]): string {
  for (const pref of ['image/webp', 'image/jpeg', 'image/png', 'image/gif']) {
    if (mimes.includes(pref)) return pref;
  }
  return mimes[0];
}
