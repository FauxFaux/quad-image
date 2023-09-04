import { Component, createRef } from 'preact';
import { useEffect, useMemo } from 'preact/compat';
import { ThumbList } from './thumb-list';

interface HomeState {
  imRightWidth?: number;
}

export class Home extends Component<{}, HomeState> {
  imRight = createRef<HTMLDivElement>();

  render(props: {}, state: Readonly<HomeState>) {
    const existing: string[] = useMemo(
      () => JSON.parse(localStorage.getItem('quadpees') ?? '[]'),
      [],
    );

    const upload = (
      <div class={'container-fluid'}>
        <div class={'row'}>
          <div class={'col home--upload_drop'}>
            <span>drop files here</span>
          </div>
        </div>
        <div class={'row'}>
          <div class={'col-9 home--upload_pick'}>
            <input class={'form-control'} type={'file'} />
          </div>
          <div class={'col-3 home--upload_paste'}>
            <button class={'btn btn-secondary home--upload_button'}>
              paste
            </button>
          </div>
        </div>
      </div>
    );

    const onResize = () => {
      this.setState({
        imRightWidth: this.imRight.current?.getBoundingClientRect()?.width,
      });
    };

    useEffect(() => {
      window.addEventListener('resize', onResize);
      onResize();
      return () => window.removeEventListener('resize', onResize);
    }, []);

    const rightCount = Math.floor((state.imRightWidth ?? 1000) / 300);
    const existingRight = existing.slice(0, rightCount);
    const existingBottom = existing.slice(rightCount);

    return (
      <div class={'container-fluid'}>
        <div class={'row'}>
          <div class={'col home--sign_in'}>
            <div>Gallery backup: off; local only</div>
          </div>
        </div>
        <div class={'row'}>
          <div class={'col-md'}>{upload}</div>
          <div class={'col-md'} ref={this.imRight}>
            <ThumbList items={existingRight} />
          </div>
        </div>
        <div class={'row'}>
          <div class={'col'}>
            <ThumbList items={existingBottom} />
          </div>
        </div>
      </div>
    );
  }
}
