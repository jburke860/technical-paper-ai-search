import { BookIcon, MenuIcon, PanelIcon } from "@/components/icons";

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
        <span className="brand-mark"><BookIcon /></span>
        <span>
          <strong>Technical Paper AI</strong>
          <small>Search assistant</small>
        </span>
      </div>

      <nav className="primary-nav" aria-label="Primary navigation">
        <a className="is-active" href="#workspace">Research</a>
        <a href="#library">Library</a>
        <a href="#method">Method</a>
      </nav>

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
