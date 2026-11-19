type Props = {
  title?: string;
  compact?: boolean;
  opacity?: number;
  onOpacityChange?: (value: number) => void;
  onFloat?: () => void;
};

export function TitleBar({
  title = "Meeting Cue",
  compact = false,
  onFloat,
}: Props) {
  return (
    <header className={`titlebar ${compact ? "compact" : ""}`}>
      <div className="titlebar-drag">
        <span className="titlebar-dot" aria-hidden />
        <strong className="titlebar-title">{title}</strong>
      </div>

      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-btn win"
          title="Float on screen"
          onClick={() => {
            onFloat?.();
            void window.meetingCue?.windowMinimize?.();
          }}
        >
          ─
        </button>
        <button
          type="button"
          className="titlebar-btn win"
          title="Maximize"
          onClick={() => window.meetingCue?.windowMaximize?.()}
        >
          □
        </button>
        <button
          type="button"
          className="titlebar-btn win close"
          title="Close"
          onClick={() => window.meetingCue?.windowClose?.()}
        >
          ×
        </button>
      </div>
    </header>
  );
}
