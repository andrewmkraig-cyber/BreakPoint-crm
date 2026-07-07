import React from "react";
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from "@react-pdf/renderer";
import { parseDocument } from "htmlparser2";
import type { ChildNode, Element, Text as DomText } from "domhandler";

type InlineRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

type TextBlock = {
  type: "paragraph" | "heading";
  level?: number;
  runs: InlineRun[];
};

type ListBlock = {
  type: "list-item";
  ordered: boolean;
  index: number;
  depth: number;
  runs: InlineRun[];
};

type TableBlock = {
  type: "table";
  rows: InlineRun[][][];
};

type Block = TextBlock | ListBlock | TableBlock;

type InlineStyle = Omit<InlineRun, "text">;

Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingBottom: 54,
    paddingHorizontal: 54,
    fontFamily: "Times-Roman",
    fontSize: 11,
    color: "#111111",
    lineHeight: 1.35,
  },
  paragraph: {
    marginBottom: 6,
  },
  heading1: {
    marginTop: 8,
    marginBottom: 6,
    fontFamily: "Times-Bold",
    fontSize: 14,
    lineHeight: 1.2,
  },
  heading2: {
    marginTop: 8,
    marginBottom: 5,
    fontFamily: "Times-Bold",
    fontSize: 12.5,
    lineHeight: 1.2,
  },
  heading3: {
    marginTop: 7,
    marginBottom: 4,
    fontFamily: "Times-Bold",
    fontSize: 11.5,
    lineHeight: 1.2,
  },
  listRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  listMarker: {
    width: 18,
    fontSize: 11,
  },
  listText: {
    flex: 1,
  },
  table: {
    marginBottom: 7,
  },
  tableRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  tableCell: {
    flex: 1,
    paddingRight: 8,
  },
});

export async function convertDocxToPdfViaFreeRenderer(
  docxBytes: Buffer,
): Promise<Buffer> {
  const mammoth = await import("mammoth");
  const convert = mammoth.convertToHtml ?? mammoth.default?.convertToHtml;
  if (!convert) throw new Error("DOCX HTML converter unavailable.");

  const result = await convert(
    { buffer: docxBytes },
    {
      includeDefaultStyleMap: true,
      styleMap: [
        "p[style-name='Title'] => h1.resume-title:fresh",
        "p[style-name='Subtitle'] => p.resume-contact:fresh",
      ],
    },
  );
  const blocks = htmlToBlocks(result.value ?? "");
  if (blocks.length === 0) {
    throw new Error("DOCX conversion produced no readable content.");
  }

  const pdfDoc = pdf(FreeDocxPdfDocument({ blocks }));
  const stream = await pdfDoc.toBuffer();
  const chunks: Buffer[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function FreeDocxPdfDocument({ blocks }: { blocks: Block[] }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {blocks.map((block, index) => (
          <BlockView key={index} block={block} />
        ))}
      </Page>
    </Document>
  );
}

function BlockView({ block }: { block: Block }) {
  if (block.type === "heading") {
    const style =
      block.level === 1
        ? styles.heading1
        : block.level === 2
          ? styles.heading2
          : styles.heading3;
    return <Text style={style}>{renderRuns(forceBold(block.runs))}</Text>;
  }

  if (block.type === "list-item") {
    const marker = block.ordered ? `${block.index}.` : "•";
    return (
      <View style={[styles.listRow, { marginLeft: block.depth * 14 }]}>
        <Text style={styles.listMarker}>{marker}</Text>
        <Text style={styles.listText}>{renderRuns(block.runs)}</Text>
      </View>
    );
  }

  if (block.type === "table") {
    return (
      <View style={styles.table}>
        {block.rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.tableRow}>
            {row.map((cell, cellIndex) => (
              <Text key={cellIndex} style={styles.tableCell}>
                {renderRuns(cell)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    );
  }

  return <Text style={styles.paragraph}>{renderRuns(block.runs)}</Text>;
}

function renderRuns(runs: InlineRun[]) {
  return mergeRuns(runs).map((run, index) => {
    const fontFamily = run.bold
      ? run.italic
        ? "Times-BoldItalic"
        : "Times-Bold"
      : run.italic
        ? "Times-Italic"
        : "Times-Roman";
    return (
      <Text
        key={index}
        style={{
          fontFamily,
          textDecoration: run.underline ? "underline" : undefined,
        }}
      >
        {run.text}
      </Text>
    );
  });
}

function htmlToBlocks(html: string): Block[] {
  const document = parseDocument(html);
  return normalizeBlocks(collectBlocks(document.children));
}

function collectBlocks(nodes: ChildNode[], depth = 0): Block[] {
  const blocks: Block[] = [];
  for (const node of nodes) {
    if (!isElement(node)) continue;
    const name = node.name.toLowerCase();

    if (name === "html" || name === "body" || name === "div" || name === "section") {
      blocks.push(...collectBlocks(node.children, depth));
      continue;
    }

    if (name === "h1" || name === "h2" || name === "h3") {
      const runs = extractRuns(node.children, { bold: true });
      if (hasText(runs)) {
        blocks.push({ type: "heading", level: Number(name.slice(1)), runs });
      }
      continue;
    }

    if (name === "p") {
      const runs = extractRuns(node.children);
      if (hasText(runs)) blocks.push({ type: "paragraph", runs });
      continue;
    }

    if (name === "ul" || name === "ol") {
      blocks.push(...collectListBlocks(node, name === "ol", depth));
      continue;
    }

    if (name === "table") {
      const table = collectTable(node);
      if (table.rows.length > 0) blocks.push(table);
      continue;
    }

    blocks.push(...collectBlocks(node.children, depth));
  }
  return blocks;
}

function collectListBlocks(list: Element, ordered: boolean, depth: number): Block[] {
  const blocks: Block[] = [];
  let itemIndex = 1;
  for (const child of list.children) {
    if (!isElement(child) || child.name.toLowerCase() !== "li") continue;
    const inlineChildren = child.children.filter((n) => !isListElement(n));
    const runs = extractRuns(inlineChildren);
    if (hasText(runs)) {
      blocks.push({ type: "list-item", ordered, index: itemIndex, depth, runs });
      itemIndex += 1;
    }
    const nestedLists = child.children.filter(isListElement);
    for (const nested of nestedLists) {
      blocks.push(...collectListBlocks(nested, nested.name.toLowerCase() === "ol", depth + 1));
    }
  }
  return blocks;
}

function collectTable(table: Element): TableBlock {
  const rows: InlineRun[][][] = [];
  for (const row of findElements(table, "tr")) {
    const cells = row.children
      .filter((child): child is Element => {
        if (!isElement(child)) return false;
        const name = child.name.toLowerCase();
        return name === "td" || name === "th";
      })
      .map((cell) => {
        const bold = cell.name.toLowerCase() === "th";
        return extractRuns(cell.children, { bold });
      })
      .filter(hasText);
    if (cells.length > 0) rows.push(cells);
  }
  return { type: "table", rows };
}

function findElements(root: Element, tagName: string): Element[] {
  const found: Element[] = [];
  for (const child of root.children) {
    if (!isElement(child)) continue;
    if (child.name.toLowerCase() === tagName) found.push(child);
    found.push(...findElements(child, tagName));
  }
  return found;
}

function extractRuns(nodes: ChildNode[], style: InlineStyle = {}): InlineRun[] {
  const runs: InlineRun[] = [];
  for (const node of nodes) {
    if (isTextNode(node)) {
      const text = cleanText(node.data);
      if (text) runs.push({ ...style, text });
      continue;
    }
    if (!isElement(node)) continue;
    const name = node.name.toLowerCase();
    if (name === "br") {
      runs.push({ ...style, text: "\n" });
      continue;
    }
    const nextStyle: InlineStyle = {
      ...style,
      bold: style.bold || name === "strong" || name === "b",
      italic: style.italic || name === "em" || name === "i",
      underline: style.underline || name === "u" || name === "a",
    };
    runs.push(...extractRuns(node.children, nextStyle));
  }
  return mergeRuns(runs);
}

function normalizeBlocks(blocks: Block[]): Block[] {
  return blocks.filter((block) => {
    if (block.type === "table") return block.rows.some((row) => row.some(hasText));
    return hasText(block.runs);
  });
}

function mergeRuns(runs: InlineRun[]): InlineRun[] {
  const merged: InlineRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.bold === run.bold &&
      prev.italic === run.italic &&
      prev.underline === run.underline
    ) {
      prev.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

function forceBold(runs: InlineRun[]): InlineRun[] {
  return runs.map((run) => ({ ...run, bold: true }));
}

function hasText(runs: InlineRun[]): boolean {
  return runs.some((run) => run.text.trim().length > 0);
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t\r\n]+/g, " ");
}

function isElement(node: ChildNode): node is Element {
  return node.type === "tag";
}

function isTextNode(node: ChildNode): node is DomText {
  return node.type === "text";
}

function isListElement(node: ChildNode): node is Element {
  return isElement(node) && ["ul", "ol"].includes(node.name.toLowerCase());
}
