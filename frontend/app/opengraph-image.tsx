import { ImageResponse } from "next/og";

// Rendered at build time so the static export can include the image.
export const dynamic = "force-static";
export const alt = "Technical Paper AI Search Assistant";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#f5f4ef", color: "#17211d", padding: 72, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", border: "1px solid #ccd3ca", borderRadius: 28, padding: 54, background: "#fbfaf6" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 24, color: "#1a5d4b" }}>
          <div style={{ width: 50, height: 50, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "#123f35", color: "white" }}>P</div>
          TECHNICAL PAPER AI · SOURCE-GROUNDED RESEARCH
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, lineHeight: 1.05, letterSpacing: -3 }}>Ask your technical library.</div>
          <div style={{ fontSize: 30, color: "#59645e" }}>Hybrid retrieval, grounded synthesis, and citations you can verify.</div>
        </div>
        <div style={{ display: "flex", gap: 36, fontSize: 22, color: "#1a5d4b" }}>
          <span>Hybrid search</span><span>Stable citations</span><span>Real paper pages</span>
        </div>
      </div>
    </div>,
    size,
  );
}
