import { useRef } from "react";
import { BookIcon, CloseIcon, FileIcon, HistoryIcon, LayersIcon } from "@/components/icons";
import { useDrawerFocus } from "@/lib/use-drawer-focus";
import type { HistoryEntry, Paper } from "@/app/types";

type LibrarySidebarProps = {
  papers: Paper[];
  chunkCount: number | null;
  open: boolean;
  history: HistoryEntry[];
  sourceCount: number;
  onClose: () => void;
  onSelectHistory: (entry: HistoryEntry) => void;
  onShowSources: () => void;
};

export function LibrarySidebar({ papers, chunkCount, open, history, sourceCount, onClose, onSelectHistory, onShowSources }: LibrarySidebarProps) {
  const topics = [...new Set(papers.flatMap((paper) => paper.topics))].slice(0, 6);
  const drawerRef = useRef<HTMLElement>(null);
  useDrawerFocus(open, drawerRef, "(max-width: 820px)");

  return (
    <>
      <button
        className={`drawer-scrim ${open ? "is-open" : ""}`}
        onClick={onClose}
        aria-label="Close library"
        tabIndex={open ? 0 : -1}
      />
      <aside ref={drawerRef} id="library" className={`library-sidebar ${open ? "is-open" : ""}`} aria-label="Document library">
        <div className="sidebar-heading">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>Curated library</h2>
          </div>
          <button className="icon-button sidebar-close" onClick={onClose} aria-label="Close library">
            <CloseIcon />
          </button>
        </div>

        <div className="library-summary">
          <BookIcon />
          <span><strong>{papers.length || "—"}</strong> papers</span>
          <span><strong>{chunkCount ?? "—"}</strong> passages</span>
        </div>

        <nav className="sidebar-nav" aria-label="Library views">
          <button
            type="button"
            className="is-active"
            onClick={() => drawerRef.current?.querySelector(".paper-list")?.scrollIntoView({ block: "nearest" })}
          >
            <LayersIcon /><span>All papers</span><b>{papers.length || "—"}</b>
          </button>
          <button type="button" onClick={() => { onShowSources(); onClose(); }}>
            <FileIcon /><span>Retrieved sources</span><b>{sourceCount || "—"}</b>
          </button>
        </nav>

        <div className="sidebar-section">
          <p className="eyebrow">Topics in this corpus</p>
          <div className="topic-list">
            {topics.length > 0 ? topics.map((topic) => <span key={topic}>{topic}</span>) : <span>Loading corpus…</span>}
          </div>
        </div>

        <div className="sidebar-section history-list">
          <p className="eyebrow">Recent research</p>
          {history.length > 0 ? history.map((entry) => (
            <button key={entry.id} onClick={() => { onSelectHistory(entry); onClose(); }}>
              <HistoryIcon />
              <span><strong>{entry.question}</strong><small>{new Date(entry.createdAt).toLocaleDateString()}</small></span>
            </button>
          )) : <p className="history-empty">Completed questions are saved only in this browser.</p>}
        </div>

        <div className="sidebar-section paper-list">
          <p className="eyebrow">Documents</p>
          {papers.map((paper) => (
            <a href={paper.source_url ?? paper.pdf_url} target="_blank" rel="noreferrer" key={paper.id}>
              <FileIcon />
              <span><strong>{paper.title}</strong><small>{paper.year} · {paper.authors.length} authors</small></span>
            </a>
          ))}
        </div>

        <div className="privacy-note">
          <span className="privacy-icon">P</span>
          <p><strong>Curated and read-only</strong><br />The hosted index contains only the public papers listed here.</p>
        </div>
      </aside>
    </>
  );
}
