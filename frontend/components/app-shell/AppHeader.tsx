"use client";

import { useEffect, useState } from "react";
import { CloseIcon, MenuIcon, PanelIcon } from "@/components/icons";
import type { QuotaStatus } from "@/app/types";

type AppHeaderProps = {
  statusLabel: string;
  statusTone: "ready" | "paused" | "loading";
  quota: QuotaStatus | null;
  libraryOpen: boolean;
  sourcesOpen: boolean;
  onOpenLibrary: () => void;
  onOpenSources: () => void;
};

export function AppHeader({
  statusLabel,
  statusTone,
  quota,
  libraryOpen,
  sourcesOpen,
  onOpenLibrary,
  onOpenSources,
}: AppHeaderProps) {
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (!aboutOpen) return;
    function close(event: KeyboardEvent) {
      if (event.key === "Escape") setAboutOpen(false);
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [aboutOpen]);

  const resetsAt = quota
    ? new Date(quota.resetsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <header className="app-header">
      <div className="brand-lockup">
        {/* eslint-disable-next-line @next/next/no-img-element -- static export serves the raw icon */}
        <img className="brand-mark brand-favicon" src="/favicon.ico" alt="" width={38} height={38} />
        <span>
          <strong>Technical Paper AI</strong>
          <small>Made by Jeremy Burke</small>
        </span>
      </div>

      <div className="header-actions">
        <div className="status-wrap">
          <button
            className={`system-pill ${statusTone}`}
            onClick={() => setAboutOpen((open) => !open)}
            aria-expanded={aboutOpen}
            aria-haspopup="dialog"
          >
            <span className="status-dot" />
            {statusLabel}
          </button>
          {aboutOpen && (
            <>
              <button className="popover-scrim" aria-label="Close demo details" onClick={() => setAboutOpen(false)} />
              <div className="about-popover" role="dialog" aria-label="About this demo">
                <div className="about-heading">
                  <p className="eyebrow">Zero-cost by design</p>
                  <button className="icon-button" onClick={() => setAboutOpen(false)} aria-label="Close demo details">
                    <CloseIcon />
                  </button>
                </div>
                <p>
                  This demo runs entirely on free-tier infrastructure with hard caps
                  instead of a payment method, so it pauses rather than bills.
                </p>
                <ul>
                  <li><strong>{quota?.limit ?? 200}</strong> hosted questions per day, shared by all visitors</li>
                  <li><strong>20</strong> per browser per day, <strong>3</strong> per minute</li>
                  {quota && (
                    <li>
                      <strong>{quota.remaining}</strong> remaining today · resets {resetsAt}
                    </li>
                  )}
                </ul>
                <p>
                  When capacity runs out, hosted answering pauses until the next UTC
                  day. Searching your own PDF keeps working — it runs entirely in
                  your browser and consumes no hosted capacity.
                </p>
              </div>
            </>
          )}
        </div>
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
