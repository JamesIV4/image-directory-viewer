import { useRef, useState } from 'react';
import * as Slider from '@radix-ui/react-slider';

export function localDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  // Retain sub-minute precision so dragging does not round away edge images.
  const local = new Date(timestamp - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 23);
}

export default function DateRangeSlider({ minimum, maximum, newerThan, olderThan, onChange }: {
  minimum: number | null; maximum: number | null; newerThan: string; olderThan: string;
  onChange: (start: string, end: string) => void;
}) {
  const bar = useRef<HTMLSpanElement>(null);
  const dragging = useRef<number | null>(null);
  const [tooltip, setTooltip] = useState<{ timestamp: number; position: number } | null>(null);
  const min = minimum ?? 0, max = maximum ?? 1;
  const span = max - min;
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const values = [clamp(newerThan ? new Date(newerThan).getTime() : min), clamp(olderThan ? new Date(olderThan).getTime() : max)];
  const position = (timestamp: number) => span ? (timestamp - min) / span * 100 : 50;
  const showValue = (timestamp: number) => setTooltip({ timestamp, position: position(timestamp) });
  const hoverAt = (clientX: number) => {
    const rect = bar.current!.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return min + fraction * span;
  };
  const valid = minimum !== null && maximum !== null;
  return <div className="date-range-control">
    <Slider.Root ref={bar} className="date-range-bar" min={min} max={max > min ? max : min + 1}
      step={Math.max(1, Math.round(span / 1000))} value={values} disabled={!valid || !span}
      aria-label="Modified date range"
      onValueChange={next => {
        // Outer endpoints mean no limit, keeping oldest/newest images included.
        onChange(next[0] <= min ? '' : localDateTime(next[0]), next[1] >= max ? '' : localDateTime(next[1]));
        const active = dragging.current ?? Number(document.activeElement?.getAttribute('data-date-handle') || 0);
        showValue(next[active]);
      }}
      onValueCommit={() => { dragging.current = null; setTooltip(null); }}
      onPointerDownCapture={event => {
        if (!valid || !span) return;
        const target = (event.target as HTMLElement).closest('[data-date-handle]');
        const timestamp = hoverAt(event.clientX);
        dragging.current = target ? Number(target.getAttribute('data-date-handle')) : Math.abs(timestamp - values[0]) <= Math.abs(timestamp - values[1]) ? 0 : 1;
        showValue(values[dragging.current]);
      }}
      onPointerMove={event => { if (valid && dragging.current === null) showValue(hoverAt(event.clientX)); }}
      onPointerLeave={() => { if (dragging.current === null) setTooltip(null); }}
      onPointerCancel={() => { dragging.current = null; setTooltip(null); }}
      onBlurCapture={event => { if (dragging.current === null && !event.currentTarget.contains(event.relatedTarget as Node)) setTooltip(null); }}>
      <Slider.Track className="date-range-track"><Slider.Range className="date-range-selected" /></Slider.Track>
      <Slider.Thumb className="date-range-handle" data-date-handle="0" aria-label="Oldest date limit"
        aria-valuetext={valid ? new Date(values[0]).toLocaleString() : 'No images'} onFocus={() => valid && showValue(values[0])} />
      <Slider.Thumb className="date-range-handle" data-date-handle="1" aria-label="Newest date limit"
        aria-valuetext={valid ? new Date(values[1]).toLocaleString() : 'No images'} onFocus={() => valid && showValue(values[1])} />
    </Slider.Root>
    {tooltip && valid && <div className="date-range-tooltip" role="tooltip" style={{ left: `clamp(90px, ${tooltip.position}%, calc(100% - 90px))` }}>{new Date(tooltip.timestamp).toLocaleString()}</div>}
    <div className="date-range-endpoints"><span title={valid ? new Date(min).toLocaleString() : undefined}>{valid ? new Date(min).toLocaleDateString() : 'No dated images'}</span><span title={valid ? new Date(max).toLocaleString() : undefined}>{valid ? new Date(max).toLocaleDateString() : ''}</span></div>
  </div>;
}
