import { MenuIcon, PanelIcon } from "@/components/icons";

type AppHeaderProps = {
  statusLabel: string;
  statusTone: "ready" | "paused" | "loading";
  libraryOpen: boolean;
  sourcesOpen: boolean;
  onOpenLibrary: () => void;
  onOpenSources: () => void;
};

export function AppHeader({
  statusLabel,
  statusTone,
  libraryOpen,
  sourcesOpen,
  onOpenLibrary,
  onOpenSources,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="brand-lockup">
        {/* eslint-disable-next-line @next/next/no-img-element -- static export serves the raw icon */}
        <img className="brand-mark brand-favicon" src="/favicon.ico" alt="" width={38} height={38} />
        <span>
          <strong>Technical Paper AI</strong>
          <small>Search assistant</small>
        </span>
      </div>

      <div className="header-actions">
        <span className={`system-pill ${statusTone}`}>
          <span className="status-dot" />
          {statusLabel}
        </span>
        <button className="icon-button mobile-only" onClick={onOpenLibrary} aria-label="Open library" aria-controls="library" aria-expanded={libraryOpen}>
          <MenuIcon />
        </button>
        <button className="icon-button tablet-only" onClick={onOpenSources} aria-label="Open source panel" aria-controls="sources" aria-expanded={sourcesOpen}>
          <PanelIcon />
        </button>
      </div>
    </header>
  );
}
