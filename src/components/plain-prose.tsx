import { cn } from "@/lib/utils";

// Renders plain-text Claude output (no markdown) with visually bold headers
// and real bullet rendering. Expected input format:
//
//   Section Header
//   paragraph text...
//
//   Another Section
//   • bullet one
//   • bullet two
//
// Rules for "is this a header":
//   - Non-bullet, non-empty line
//   - Short (<= 80 chars)
//   - No terminal punctuation
//   - Is immediately followed by a bullet line OR another paragraph line
//
// Headers render bold; bullet lines render as a real <ul>; other non-bullet
// lines render as paragraphs.
export function PlainProse({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: JSX.Element[] = [];
  let i = 0;
  let key = 0;

  const isBullet = (s: string) => /^\s*•\s+/.test(s);
  const trimBullet = (s: string) => s.replace(/^\s*•\s+/, "");

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (isBullet(line)) {
      const items: string[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        items.push(trimBullet(lines[i]));
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="mb-3 list-none space-y-1.5 pl-0">
          {items.map((item, idx) => (
            <li key={idx} className="flex gap-2 text-sm leading-relaxed text-navy">
              <span aria-hidden className="mt-[2px] select-none text-brand-dark">•</span>
              <span className="min-w-0">{renderInline(item)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Non-bullet line. Treat as header if it qualifies, else paragraph.
    const next = lines[i + 1] ?? "";
    const trimmed = line.trim();
    const looksLikeHeader =
      trimmed.length > 0 &&
      trimmed.length <= 80 &&
      !/[.,;:]$/.test(trimmed) &&
      (isBullet(next) || next.trim() !== "");

    if (looksLikeHeader) {
      blocks.push(
        <div key={key++} className="mb-2 mt-4 font-serif text-base font-bold text-navy first:mt-0">
          {trimmed}
        </div>,
      );
      i += 1;
      continue;
    }

    // Paragraph: gather consecutive non-bullet, non-blank lines into one paragraph.
    const para: string[] = [trimmed];
    i += 1;
    while (i < lines.length && lines[i].trim() !== "" && !isBullet(lines[i])) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push(
      <p key={key++} className="mb-3 text-sm leading-relaxed text-navy">
        {para.join(" ")}
      </p>,
    );
  }

  return <div className={cn("text-navy", className)}>{blocks}</div>;
}

// Turn "Label: value" into <strong>Label:</strong> value inside bullet items,
// so bullets like "Medical: Aetna, $120/mo" render with a bold label.
function renderInline(text: string): React.ReactNode {
  const match = text.match(/^([^:\n]{1,60}):\s*(.*)$/);
  if (!match) return text;
  const [, label, rest] = match;
  return (
    <>
      <strong className="font-bold text-navy">{label}:</strong>{" "}
      <span className="text-navy">{rest}</span>
    </>
  );
}
