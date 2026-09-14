import { useRef, useState } from 'preact/hooks';

interface ImageComparisonProps {
  originalUrl: string;
  previewUrl: string;
  previewAlt: string;
}

export function ImageComparison(props: ImageComparisonProps) {
  const container = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(2);

  const moveBar = (clientX: number) => {
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    const percent = ((clientX - bounds.left) / bounds.width) * 100;
    setPosition(Math.min(100, Math.max(0, percent)));
  };

  return (
    <div
      class={'image-comparison'}
      ref={container}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        moveBar(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          moveBar(event.clientX);
        }
      }}
    >
      <img src={props.previewUrl} alt={props.previewAlt} draggable={false} />
      <div
        class={'image-comparison--original'}
        aria-hidden="true"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <img src={props.originalUrl} alt={''} draggable={false} />
        <span>original</span>
      </div>
      <div
        class={'image-comparison--bar'}
        aria-hidden="true"
        style={{ left: `${position}%` }}
      />
    </div>
  );
}
