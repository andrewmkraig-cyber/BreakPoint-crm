import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

import { PUBLIC_JOBS_SITE_ORIGIN, type PublicWebsiteJob } from "@/lib/public-jobs";

function escapeXml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cdata(value: string): string {
  // A literal ]]> closes a CDATA section. Split it across two sections so
  // arbitrary job copy can never produce malformed XML.
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

export function zipRecruiterJobType(employmentType: string): string | null {
  const normalized = employmentType.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized === "fulltime") return "Full-Time";
  if (normalized === "parttime") return "Part-Time";
  if (normalized === "contract" || normalized === "contractor") return "Contractor";
  return null;
}

export function zipRecruiterCompensationInterval(frequency: string | null): string | null {
  const normalized = frequency?.trim().toLowerCase();
  if (normalized === "yearly" || normalized === "annual" || normalized === "annually") {
    return "Annually";
  }
  if (normalized === "hourly" || normalized === "hour") return "Hourly";
  return null;
}

function descriptionHtml(markdown: string): string {
  const rendered = String(marked.parse(markdown, { gfm: true }));
  return sanitizeHtml(rendered, {
    allowedTags: [
      "p", "br", "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li", "strong", "b", "em", "i", "blockquote", "a",
    ],
    allowedAttributes: { a: ["href", "title"] },
    allowedSchemes: ["http", "https", "mailto"],
  });
}

function optionalElement(name: string, value: string | number | null): string[] {
  return value == null || value === "" ? [] : [`    <${name}>${escapeXml(value)}</${name}>`];
}

function renderJob(job: PublicWebsiteJob): string {
  const publicUrl = `${PUBLIC_JOBS_SITE_ORIGIN}/jobs/${job.slug}/`;
  const jobType = zipRecruiterJobType(job.employmentType);
  const hasCompensation = job.salary.minimum != null || job.salary.maximum != null;
  const compensationInterval = zipRecruiterCompensationInterval(job.salary.frequency);
  const compensationCurrency = hasCompensation
    ? job.salary.currency?.trim().toUpperCase() || "USD"
    : null;

  return [
    "  <job>",
    `    <referencenumber>${escapeXml(job.id)}</referencenumber>`,
    `    <title>${escapeXml(job.title)}</title>`,
    `    <description>${cdata(descriptionHtml(job.description))}</description>`,
    `    <country>${escapeXml(job.location.country)}</country>`,
    `    <city>${escapeXml(job.location.city)}</city>`,
    ...optionalElement("state", job.location.state),
    ...optionalElement("postalcode", job.location.postalCode),
    `    <company>${escapeXml(job.company)}</company>`,
    `    <date>${escapeXml(job.datePosted)}</date>`,
    `    <url>${escapeXml(publicUrl)}</url>`,
    ...optionalElement("jobtype", jobType),
    ...optionalElement("compensation_min", job.salary.minimum),
    ...optionalElement("compensation_max", job.salary.maximum),
    ...optionalElement("compensation_currency", compensationCurrency),
    ...optionalElement("compensation_interval", hasCompensation ? compensationInterval : null),
    "  </job>",
  ].join("\n");
}

export function buildJobsXml(jobs: PublicWebsiteJob[]): string {
  const renderedJobs = jobs.map(renderJob);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<source>",
    ...renderedJobs,
    "</source>",
    "",
  ].join("\n");
}
