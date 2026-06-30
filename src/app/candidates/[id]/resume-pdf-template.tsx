// Server-only PDF resume template rendered with @react-pdf/renderer.
// Two-column letter-size layout: a brand-green header band, a 35% left
// sidebar (contact / skills / education / certifications), a 65% right
// column (summary / experience). Section headers are uppercase with a
// brand-green underline rule, bullets use a hyphen-prefix paragraph
// pattern that wraps cleanly across multiple lines. Helvetica throughout
// — built into @react-pdf, no external font fetch.
//
// generate-resume-action.ts asks Claude for structured JSON, parses it
// into ResumeData, then ships it through this component to produce the
// final PDF bytes.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  Link,
} from "@react-pdf/renderer";

// Brand green from ACE_DESIGN.md — used for the role title under the
// name + the underline rule beneath every section header. Hardcoded
// because PDFs are static assets that don't follow Court Mode tokens.
const BRAND_GREEN = "#5A9642";
const BRAND_GREEN_DARK = "#3F7030";
const NEUTRAL_900 = "#111827";
const NEUTRAL_700 = "#374151";
const NEUTRAL_500 = "#6B7280";

export type ResumeExperienceEntry = {
  title: string;
  company: string;
  dates: string;
  location?: string;
  bullets: string[];
};

export type ResumeEducationEntry = {
  degree: string;
  school: string;
  year?: string;
  details?: string;
};

export type ResumeData = {
  name: string;
  title: string;
  contact: {
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
  };
  summary?: string;
  experience: ResumeExperienceEntry[];
  education: ResumeEducationEntry[];
  skills: string[];
  certifications: string[];
};

// Disable hyphenation — resumes look unprofessional with broken words.
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 36,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: NEUTRAL_900,
    lineHeight: 1.4,
  },
  // Header band — name + title.
  header: {
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: BRAND_GREEN,
  },
  name: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: NEUTRAL_900,
    letterSpacing: 0.5,
    // Tight line-box on the name so the descender slack (page-default
    // lineHeight 1.4 over 24pt = ~9pt below baseline) doesn't push
    // into the title underneath. Without this, the green role line
    // sits inside the name's descenders and the two read as one
    // muddy block instead of cleanly stacked lines.
    lineHeight: 1.1,
  },
  title: {
    marginTop: 10,
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: BRAND_GREEN_DARK,
    letterSpacing: 0.3,
    lineHeight: 1.2,
  },
  // Body grid — left sidebar + right main column.
  body: {
    flexDirection: "row",
    gap: 20,
  },
  sidebar: {
    width: "32%",
    paddingRight: 8,
  },
  main: {
    width: "68%",
  },
  // Section header — uppercase, tight tracking, green underline.
  sectionHeader: {
    marginTop: 14,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: BRAND_GREEN,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: BRAND_GREEN_DARK,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  // First section header on a column — no top margin so it aligns with
  // the sibling column's first header.
  firstSectionHeader: {
    marginTop: 0,
  },
  // Contact rows in the sidebar.
  contactRow: {
    marginBottom: 3,
    fontSize: 9,
    color: NEUTRAL_700,
    lineHeight: 1.25,
  },
  contactLink: {
    marginBottom: 3,
    fontSize: 9,
    color: BRAND_GREEN_DARK,
    lineHeight: 1.25,
    textDecoration: "none",
  },
  // Skills / certifications list — one per line with a bullet.
  listItem: {
    marginBottom: 2,
    fontSize: 9,
    color: NEUTRAL_700,
    flexDirection: "row",
  },
  listBullet: {
    width: 8,
    color: BRAND_GREEN,
  },
  listText: {
    flex: 1,
  },
  // Education entry block.
  educationEntry: {
    marginBottom: 8,
  },
  educationDegree: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: NEUTRAL_900,
  },
  educationSchool: {
    fontSize: 9,
    color: NEUTRAL_700,
  },
  educationYear: {
    fontSize: 8.5,
    color: NEUTRAL_500,
    fontStyle: "italic",
  },
  // Summary paragraph in the main column.
  summaryText: {
    fontSize: 10,
    color: NEUTRAL_700,
    lineHeight: 1.5,
  },
  // Experience entries.
  experienceEntry: {
    marginBottom: 12,
  },
  experienceTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: NEUTRAL_900,
  },
  experienceCompanyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 1,
    marginBottom: 4,
  },
  experienceCompany: {
    fontSize: 10,
    color: BRAND_GREEN_DARK,
    fontFamily: "Helvetica-Bold",
    flex: 1,
    paddingRight: 8,
  },
  experienceDates: {
    fontSize: 9,
    color: NEUTRAL_500,
    fontStyle: "italic",
    textAlign: "right",
  },
  experienceBullet: {
    flexDirection: "row",
    marginTop: 2,
    fontSize: 10,
    color: NEUTRAL_700,
  },
  experienceBulletDash: {
    width: 10,
    color: BRAND_GREEN,
  },
  experienceBulletText: {
    flex: 1,
    lineHeight: 1.4,
  },
});

export function ResumeDocument({ data }: { data: ResumeData }) {
  // Filter out empty contact lines so the sidebar doesn't render blanks.
  const contactRows = buildContactRows(data.contact);

  const hasSkills = data.skills.length > 0;
  const hasEducation = data.education.length > 0;
  const hasCertifications = data.certifications.length > 0;
  const hasSummary = Boolean(data.summary?.trim());
  const hasExperience = data.experience.length > 0;

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.name}>{data.name}</Text>
          {data.title ? <Text style={styles.title}>{data.title}</Text> : null}
        </View>

        <View style={styles.body}>
          {/* ---- Sidebar ----------------------------------- */}
          <View style={styles.sidebar}>
            {contactRows.length > 0 && (
              <>
                <Text style={[styles.sectionHeader, styles.firstSectionHeader]}>
                  Contact
                </Text>
                {contactRows.map((row, i) =>
                  row.href ? (
                    <Link key={i} src={row.href} style={styles.contactLink}>
                      {row.label}
                    </Link>
                  ) : (
                    <Text key={i} style={styles.contactRow}>
                      {row.label}
                    </Text>
                  ),
                )}
              </>
            )}

            {hasSkills && (
              <>
                <Text
                  style={
                    contactRows.length === 0
                      ? [styles.sectionHeader, styles.firstSectionHeader]
                      : styles.sectionHeader
                  }
                >
                  Skills
                </Text>
                {data.skills.map((skill, i) => (
                  <View key={i} style={styles.listItem}>
                    <Text style={styles.listBullet}>•</Text>
                    <Text style={styles.listText}>{skill}</Text>
                  </View>
                ))}
              </>
            )}

            {hasEducation && (
              <>
                <Text style={styles.sectionHeader}>Education</Text>
                {data.education.map((ed, i) => (
                  <View key={i} style={styles.educationEntry}>
                    <Text style={styles.educationDegree}>{ed.degree}</Text>
                    <Text style={styles.educationSchool}>{ed.school}</Text>
                    {ed.year ? (
                      <Text style={styles.educationYear}>{ed.year}</Text>
                    ) : null}
                    {ed.details ? (
                      <Text style={styles.educationYear}>{ed.details}</Text>
                    ) : null}
                  </View>
                ))}
              </>
            )}

            {hasCertifications && (
              <>
                <Text style={styles.sectionHeader}>Certifications</Text>
                {data.certifications.map((cert, i) => (
                  <View key={i} style={styles.listItem}>
                    <Text style={styles.listBullet}>•</Text>
                    <Text style={styles.listText}>{cert}</Text>
                  </View>
                ))}
              </>
            )}
          </View>

          {/* ---- Main column ----------------------------------- */}
          <View style={styles.main}>
            {hasSummary && (
              <>
                <Text style={[styles.sectionHeader, styles.firstSectionHeader]}>
                  Summary
                </Text>
                <Text style={styles.summaryText}>{data.summary}</Text>
              </>
            )}

            {hasExperience && (
              <>
                <Text
                  style={
                    hasSummary
                      ? styles.sectionHeader
                      : [styles.sectionHeader, styles.firstSectionHeader]
                  }
                >
                  Experience
                </Text>
                {data.experience.map((role, i) => (
                  <View key={i} style={styles.experienceEntry}>
                    <Text style={styles.experienceTitle}>{role.title}</Text>
                    <View style={styles.experienceCompanyRow}>
                      <Text style={styles.experienceCompany}>
                        {role.company}
                        {role.location ? ` · ${role.location}` : ""}
                      </Text>
                      {role.dates ? (
                        <Text style={styles.experienceDates}>{role.dates}</Text>
                      ) : null}
                    </View>
                    {role.bullets.map((bullet, j) => (
                      <View key={j} style={styles.experienceBullet}>
                        <Text style={styles.experienceBulletDash}>–</Text>
                        <Text style={styles.experienceBulletText}>
                          {bullet}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </>
            )}
          </View>
        </View>
      </Page>
    </Document>
  );
}

function buildContactRows(contact: ResumeData["contact"]): Array<{ label: string; href?: string }> {
  const rows: Array<{ label: string; href?: string }> = [];
  const email = contact.email?.trim();
  const phone = contact.phone?.trim();
  const location = contact.location?.trim();
  const linkedin = normalizeLinkedInUrl(contact.linkedin);

  if (email) rows.push({ label: email });
  if (phone) rows.push({ label: phone });
  if (location) rows.push({ label: location });
  if (linkedin) rows.push({ label: "LinkedIn Profile", href: linkedin });

  return rows;
}

function normalizeLinkedInUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!/linkedin\.com/i.test(value)) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value.replace(/^\/+/, "")}`;
}
