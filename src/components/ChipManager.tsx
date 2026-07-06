import { X } from "lucide-react";
import { s } from "../lib/styles";

export default function ChipManager({ items, onRemove, empty, tone }: any) {
  if (!items.length) return <p style={{ ...s.empty, marginTop: 8 }}>{empty}</p>;
  return (
    <div style={{ ...s.tagWrap, marginTop: 10 }}>
      {items.map((x: string, i: number) => (
        <span key={i} style={{ ...s.tag, ...(tone === "red" ? { background: "var(--c-danger-bg)", color: "var(--c-danger)" } : {}), display: "inline-flex", gap: 5, alignItems: "center" }}>
          {x}<button onClick={() => onRemove(x)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "grid" }}><X size={12} /></button>
        </span>
      ))}
    </div>
  );
}
