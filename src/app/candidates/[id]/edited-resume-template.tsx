// Server-only PDF template for EDIT RESUME WITH CLAUDE.
//
// Edit Resume's promise is "apply only the requested change, preserve
// everything else". That requires mirroring the SOURCE resume's structure -
// its sections, their order, their entries and bullets - not forcing it into
// a fixed shape. So this template is intentionally DIFFERENT from
// resume-pdf-template.tsx (which the generator uses to build a polished
// two-column resume from structured DB fields):
//
//   * Single column, sections rendered in SOURCE ORDER. A two-column layout
//     reorders content (sidebar vs main) and an extract-and-diff of the
//     result would never match the original top-to-bottom reading order.
//   * Arbitrary section headings (Experience, Projects, Publications, Awards,
//     Languages, ...) - nothing is dropped because it isn't one of a fixed
//     set of buckets.
//   * Generic entries (optional bold primary line, secondary line, right-
//     aligned meta, a prose paragraph, and bullets) that map 1:1 onto any
//     resume section without inventing structure.
//
// Visual identity is still Ace's: brand-green header rule + green underlined
// uppercase section headers + hyphen bullets, Helvetica (built into
// @react-pdf, no external font fetch).

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

const BRAND_GREEN = "#5A9642";
const BRAND_GREEN_DARK = "#3F7030";
const NEUTRAL_900 = "#111827";
const NEUTRAL_700 = "#374151";
const NEUTRAL_500 = "#6B7280";

// One entry within a section. Every field is optional so the same shape
// mirrors a job (primary=role, secondary=company, meta=dates, bullets), a
// degree (primary=degree, secondary=school, meta=year), a summary (just
// description), a skills list (just bullets), or anything else.
export type EditedResumeEntry = {
  primary?: string;
  secondary?: string;
  meta?: string;
  description?: string;
  bullets?: string[];
};

export type EditedResumeSection = {
  heading: string;
  entries: EditedResumeEntry[];
};

export type EditedResume = {
  name: string;
  title?: string;
  // Contact lines verbatim from the source (email, phone, location, links).
  contact: string[];
  // Sections in SOURCE ORDER. Each is rendered as written.
  sections: EditedResumeSection[];
};

Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: NEUTRAL_900,
    lineHeight: 1.4,
  },
  header: {
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: BRAND_GREEN,
  },
  name: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: NEUTRAL_900,
    letterSpacing: 0.5,
    lineHeight: 1.1,
  },
  title: {
    marginTop: 6,
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: BRAND_GREEN_DARK,
    letterSpacing: 0.3,
    lineHeight: 1.2,
  },
  contactRow: {
    marginTop: 5,
    fontSize: 9,
    color: NEUTRAL_700,
    lineHeight: 1.3,
  },
  section: {
    marginTop: 14,
  },
  sectionHeader: {
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: BRAND_GREEN,
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: BRAND_GREEN_DARK,
    // Keep tracking minimal: heavy letterSpacing makes uppercase headers
    // extract (and parse in an ATS) as "S U M M A RY" instead of "SUMMARY".
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  // An entry block. The gap between entries is what separates, e.g.,
  // consecutive jobs - mirrors the blank line a source resume puts between
  // entries.
  entry: {
    marginBottom: 9,
  },
  entryHeadRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  entryPrimary: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: NEUTRAL_900,
    flex: 1,
    paddingRight: 8,
  },
  entryMeta: {
    fontSize: 9,
    color: NEUTRAL_500,
    fontStyle: "italic",
    textAlign: "right",
  },
  entrySecondary: {
    fontSize: 10,
    color: BRAND_GREEN_DARK,
    fontFamily: "Helvetica-Bold",
    marginTop: 1,
  },
  entryDescription: {
    fontSize: 10,
    color: NEUTRAL_700,
    lineHeight: 1.45,
    marginTop: 3,
  },
  bullet: {
    flexDirection: "row",
    marginTop: 2,
  },
  bulletDash: {
    width: 12,
    fontSize: 10,
    color: BRAND_GREEN,
  },
  bulletText: {
    flex: 1,
    fontSize: 10,
    color: NEUTRAL_700,
    lineHeight: 1.4,
  },
});

function Entry({ entry }: { entry: EditedResumeEntry }) {
  const hasPrimary = Boolean(entry.primary?.trim());
  const hasMeta = Boolean(entry.meta?.trim());
  const hasSecondary = Boolean(entry.secondary?.trim());
  const hasDescription = Boolean(entry.description?.trim());
  const bullets = (entry.bullets ?? []).filter((b) => b.trim().length > 0);

  return (
    <View style={styles.entry} wrap={false}>
      {(hasPrimary || hasMeta) && (
        <View style={styles.entryHeadRow}>
          {hasPrimary ? (
            <Text style={styles.entryPrimary}>{entry.primary}</Text>
          ) : (
            <Text style={styles.entryPrimary} />
          )}
          {hasMeta ? <Text style={styles.entryMeta}>{entry.meta}</Text> : null}
        </View>
      )}
      {hasSecondary ? (
        <Text style={styles.entrySecondary}>{entry.secondary}</Text>
      ) : null}
      {hasDescription ? (
        <Text style={styles.entryDescription}>{entry.description}</Text>
      ) : null}
      {bullets.map((b, i) => (
        <View key={i} style={styles.bullet}>
          <Text style={styles.bulletDash}>–</Text>
          <Text style={styles.bulletText}>{b}</Text>
        </View>
      ))}
    </View>
  );
}

export function EditedResumeDocument({ data }: { data: EditedResume }) {
  const contact = (data.contact ?? []).filter((c) => c.trim().length > 0);
  const sections = (data.sections ?? []).filter(
    (s) => s.heading?.trim() || (s.entries ?? []).length > 0,
  );

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.name}>{data.name}</Text>
          {data.title?.trim() ? (
            <Text style={styles.title}>{data.title}</Text>
          ) : null}
          {contact.length > 0 ? (
            <Text style={styles.contactRow}>{contact.join("  |  ")}</Text>
          ) : null}
        </View>

        {sections.map((section, i) => (
          <View key={i} style={styles.section}>
            {section.heading?.trim() ? (
              <Text style={styles.sectionHeader}>{section.heading}</Text>
            ) : null}
            {(section.entries ?? []).map((entry, j) => (
              <Entry key={j} entry={entry} />
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
