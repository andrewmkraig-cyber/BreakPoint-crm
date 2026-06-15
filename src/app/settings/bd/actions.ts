"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

// All paths whose data is touched by these server actions. revalidate
// after every write so the Launch flow + BD pages pick up fresh state
// on the next request without manual refresh.
const BD_PATHS = ["/settings/bd", "/bd/launch", "/bd/campaigns", "/bd/client-signal", "/bd/activity"];

function revalidateAll() {
  for (const p of BD_PATHS) revalidatePath(p);
}

// ---- Saved-search criteria shape ----

export type SavedSearchCriteria = {
  apolloSequenceId: string;
  // Optional location string passed to TheirStack when set. Blank means
  // nationwide — TheirStack uses no location filter.
  locationOverride: string;
};

export type SavedSearchInput = {
  name: string;
  contactCap: number;
  criteria: SavedSearchCriteria;
  // Optional TheirStack saved-search id. Empty/blank stores null, which keeps
  // discovery on the default title search. A real column on SavedSearch, not
  // part of the versioned criteria JSON.
  theirstackSavedSearchId?: string | null;
};

// Trim a pasted TheirStack saved-search id to null when blank so the discovery
// path's "field is empty -> fall back to DISCOVERY_TITLES" check is a simple
// null check.
function normalizeTheirstackId(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---- Verticals ----

export async function createVertical(input: { name: string; slug: string }): Promise<void> {
  const org = await getCurrentOrg();
  const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const name = input.name.trim();
  if (!name || !slug) throw new Error("Name and slug are required");
  await prisma.vertical.create({
    data: { organizationId: org.id, name, slug },
  });
  revalidateAll();
}

export async function updateVerticalDailyCap(verticalId: string, dailyCap: number | null): Promise<void> {
  const org = await getCurrentOrg();
  const owned = await prisma.vertical.findFirst({
    where: { id: verticalId, organizationId: org.id },
    select: { id: true },
  });
  if (!owned) throw new Error("Vertical not found");
  await prisma.vertical.update({
    where: { id: verticalId },
    data: { dailyCap: dailyCap == null || Number.isNaN(dailyCap) ? null : Math.max(0, Math.floor(dailyCap)) },
  });
  revalidateAll();
}

export async function deleteVertical(verticalId: string): Promise<void> {
  const org = await getCurrentOrg();
  const v = await prisma.vertical.findFirst({
    where: { id: verticalId, organizationId: org.id },
    select: { id: true, savedSearches: { select: { id: true }, take: 1 } },
  });
  if (!v) throw new Error("Vertical not found");
  if (v.savedSearches.length > 0) {
    throw new Error("Delete the vertical's saved searches first.");
  }
  await prisma.vertical.delete({ where: { id: v.id } });
  revalidateAll();
}

// ---- Saved searches ----

// A per-search contact cap can never exceed the org's global daily
// limit. Read the org's current globalDailyCap and reject anything
// higher so a crafted request can't bypass the client-side check.
// Mirrors the live validation in SavedSearchEditForm.
async function assertContactCapWithinGlobal(orgId: string, contactCap: number): Promise<void> {
  const config = await prisma.bdOrgConfig.findUnique({
    where: { organizationId: orgId },
    select: { globalDailyCap: true },
  });
  const globalDailyCap = config?.globalDailyCap ?? 80;
  if (contactCap > globalDailyCap) {
    throw new Error(
      `Daily contact cap (${contactCap}) cannot exceed the global daily limit of ${globalDailyCap}. Lower to meet daily limit.`,
    );
  }
}

export async function createSavedSearch(verticalId: string, input: SavedSearchInput): Promise<string> {
  const org = await getCurrentOrg();
  const vertical = await prisma.vertical.findFirst({
    where: { id: verticalId, organizationId: org.id },
    select: { id: true },
  });
  if (!vertical) throw new Error("Vertical not found");
  const contactCap = Math.max(0, Math.floor(input.contactCap));
  await assertContactCapWithinGlobal(org.id, contactCap);
  const created = await prisma.savedSearch.create({
    data: {
      organizationId: org.id,
      verticalId: vertical.id,
      name: input.name.trim() || "Untitled search",
      criteria: input.criteria as unknown as Prisma.InputJsonValue,
      theirstackSavedSearchId: normalizeTheirstackId(input.theirstackSavedSearchId),
      contactCap,
    },
    select: { id: true },
  });
  // Snapshot v1 of the criteria so the version history starts on
  // creation, not on the first edit.
  await prisma.savedSearchVersion.create({
    data: {
      organizationId: org.id,
      savedSearchId: created.id,
      criteria: input.criteria as unknown as Prisma.InputJsonValue,
    },
  });
  revalidateAll();
  return created.id;
}

// Updates the SavedSearch in place AND appends a new SavedSearchVersion
// row so the version history is preserved (never overwrites the
// original — per the BD Phase 3 brief). Returns the new version number
// so the caller can render "Saved · v3".
export async function updateSavedSearch(
  savedSearchId: string,
  input: SavedSearchInput,
): Promise<{ version: number }> {
  const org = await getCurrentOrg();
  const existing = await prisma.savedSearch.findFirst({
    where: { id: savedSearchId, organizationId: org.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Saved search not found");

  const contactCap = Math.max(0, Math.floor(input.contactCap));
  await assertContactCapWithinGlobal(org.id, contactCap);

  await prisma.$transaction(async (tx) => {
    await tx.savedSearch.update({
      where: { id: existing.id },
      data: {
        name: input.name.trim() || "Untitled search",
        criteria: input.criteria as unknown as Prisma.InputJsonValue,
        theirstackSavedSearchId: normalizeTheirstackId(input.theirstackSavedSearchId),
        contactCap,
      },
    });
    await tx.savedSearchVersion.create({
      data: {
        organizationId: org.id,
        savedSearchId: existing.id,
        criteria: input.criteria as unknown as Prisma.InputJsonValue,
      },
    });
  });

  const versionCount = await prisma.savedSearchVersion.count({
    where: { savedSearchId: existing.id },
  });
  revalidateAll();
  return { version: versionCount };
}

export async function deleteSavedSearch(savedSearchId: string): Promise<void> {
  const org = await getCurrentOrg();
  const existing = await prisma.savedSearch.findFirst({
    where: { id: savedSearchId, organizationId: org.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Saved search not found");
  // Hard delete — schema has no deletedAt column, and SavedSearchVersion
  // cascades from SavedSearch so the history goes with it. Future
  // soft-delete bump would add a deletedAt column on both tables.
  await prisma.savedSearch.delete({ where: { id: existing.id } });
  revalidateAll();
}

// ---- Sending domains ----

export type SendingDomainStatus = "HEALTHY" | "WARMING" | "COOLED";

export async function createSendingDomain(input: {
  domain: string;
  inboxOwner: string;
  status: SendingDomainStatus;
}): Promise<void> {
  const org = await getCurrentOrg();
  const domain = input.domain.trim().toLowerCase();
  if (!domain) throw new Error("Domain is required");
  await prisma.sendingDomain.create({
    data: {
      organizationId: org.id,
      domain,
      inboxOwner: input.inboxOwner,
      status: input.status,
      dailyCap: 20,
    },
  });
  revalidateAll();
}

export async function updateSendingDomain(
  id: string,
  patch: { domain?: string; inboxOwner?: string; status?: SendingDomainStatus },
): Promise<void> {
  const org = await getCurrentOrg();
  const existing = await prisma.sendingDomain.findFirst({
    where: { id, organizationId: org.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Sending domain not found");
  await prisma.sendingDomain.update({
    where: { id: existing.id },
    data: {
      ...(patch.domain ? { domain: patch.domain.trim().toLowerCase() } : {}),
      ...(patch.inboxOwner !== undefined ? { inboxOwner: patch.inboxOwner } : {}),
      ...(patch.status ? { status: patch.status } : {}),
    },
  });
  revalidateAll();
}

export async function deleteSendingDomain(id: string): Promise<void> {
  const org = await getCurrentOrg();
  const existing = await prisma.sendingDomain.findFirst({
    where: { id, organizationId: org.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Sending domain not found");
  await prisma.sendingDomain.delete({ where: { id: existing.id } });
  revalidateAll();
}

// ---- Contact targeting ----

export type ContactTargetingInput = {
  verticalId: string;
  primaryTitles: string[];
  smallFirmFallbackTitles: string[];
  practiceSpecificTitles: string[];
  maxPerFirm: number;
};

function cleanTitles(titles: string[]): string[] {
  return Array.from(
    new Set(
      titles
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  );
}

export async function saveContactTargeting(input: ContactTargetingInput): Promise<void> {
  const org = await getCurrentOrg();
  const vertical = await prisma.vertical.findFirst({
    where: { id: input.verticalId, organizationId: org.id },
    select: { id: true },
  });
  if (!vertical) throw new Error("Vertical not found");
  const data = {
    primaryTitles: cleanTitles(input.primaryTitles),
    smallFirmFallbackTitles: cleanTitles(input.smallFirmFallbackTitles),
    practiceSpecificTitles: cleanTitles(input.practiceSpecificTitles),
    maxPerFirm: Math.max(1, Math.min(20, Math.floor(input.maxPerFirm))),
  };
  await prisma.bdContactTargeting.upsert({
    where: { verticalId: vertical.id },
    create: { organizationId: org.id, verticalId: vertical.id, ...data },
    update: data,
  });
  revalidateAll();
}

// ---- Apollo sequence mappings (self-serve) ----

export type BdSequenceInput = {
  name: string;
  apolloSequenceId: string;
  // Vertical this sequence belongs to. Null = unmapped (selectable, but not
  // tied to a vertical).
  verticalId: string | null;
  active?: boolean;
};

// Confirm a verticalId (when provided) belongs to the caller's org so a
// mapping can never point at another tenant's vertical (Rule 8).
async function assertVerticalOwned(orgId: string, verticalId: string | null): Promise<string | null> {
  if (!verticalId) return null;
  const owned = await prisma.vertical.findFirst({
    where: { id: verticalId, organizationId: orgId },
    select: { id: true },
  });
  if (!owned) throw new Error("Vertical not found");
  return owned.id;
}

export async function createBdSequence(input: BdSequenceInput): Promise<void> {
  const org = await getCurrentOrg();
  const name = input.name.trim();
  const apolloSequenceId = input.apolloSequenceId.trim();
  if (!name) throw new Error("Sequence name is required");
  if (!apolloSequenceId) throw new Error("Apollo sequence ID is required");
  const verticalId = await assertVerticalOwned(org.id, input.verticalId);
  // Upsert on the (org, apolloSequenceId) unique key so adding the same Apollo
  // sequence again updates the existing mapping instead of erroring.
  await prisma.bdSequence.upsert({
    where: { organizationId_apolloSequenceId: { organizationId: org.id, apolloSequenceId } },
    create: { organizationId: org.id, name, apolloSequenceId, verticalId, active: input.active ?? true },
    update: { name, verticalId, active: input.active ?? true },
  });
  revalidateAll();
}

export async function updateBdSequence(id: string, input: BdSequenceInput): Promise<void> {
  const org = await getCurrentOrg();
  const existing = await prisma.bdSequence.findFirst({
    where: { id, organizationId: org.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Sequence not found");
  const name = input.name.trim();
  const apolloSequenceId = input.apolloSequenceId.trim();
  if (!name) throw new Error("Sequence name is required");
  if (!apolloSequenceId) throw new Error("Apollo sequence ID is required");
  const verticalId = await assertVerticalOwned(org.id, input.verticalId);
  await prisma.bdSequence.update({
    where: { id: existing.id },
    data: { name, apolloSequenceId, verticalId, active: input.active ?? true },
  });
  revalidateAll();
}

export async function deleteBdSequence(id: string): Promise<void> {
  const org = await getCurrentOrg();
  const existing = await prisma.bdSequence.findFirst({
    where: { id, organizationId: org.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Sequence not found");
  await prisma.bdSequence.delete({ where: { id: existing.id } });
  revalidateAll();
}

// ---- BD org config (global cap, pause-all, blackouts, reply routing) ----

export type BdOrgConfigPatch = Partial<{
  globalDailyCap: number;
  pauseAll: boolean;
  blackoutWeekends: boolean;
  blackoutHolidays: boolean;
  blackoutBefore7am: boolean;
  blackoutAfter530pm: boolean;
  replyForwardApollo: boolean;
  replyPromptCreateClient: boolean;
  replyOooFilter: boolean;
}>;

export async function updateBdOrgConfig(patch: BdOrgConfigPatch): Promise<void> {
  const org = await getCurrentOrg();
  const sanitized: BdOrgConfigPatch = { ...patch };
  if (sanitized.globalDailyCap != null) {
    sanitized.globalDailyCap = Math.max(0, Math.floor(sanitized.globalDailyCap));
  }
  await prisma.bdOrgConfig.upsert({
    where: { organizationId: org.id },
    create: { organizationId: org.id, ...sanitized },
    update: sanitized,
  });
  revalidateAll();
}

// Master BD-engine controls surfaced at the top of /settings/bd. The
// cron route + TheirStack webhook both gate on engineActive, so this
// is the single switch that takes the engine offline. globalDailyCap
// shares the same column the Daily Limits section edits — both
// editors are intentionally live so the recruiter can adjust from
// either spot.
export async function updateBDSettings(patch: {
  engineActive?: boolean;
  globalDailyCap?: number;
}): Promise<void> {
  const org = await getCurrentOrg();
  const data: { engineActive?: boolean; globalDailyCap?: number } = {};
  if (patch.engineActive !== undefined) data.engineActive = patch.engineActive;
  if (patch.globalDailyCap !== undefined) {
    const n = Math.floor(patch.globalDailyCap);
    if (Number.isNaN(n)) throw new Error("Daily cap must be a number");
    data.globalDailyCap = Math.min(200, Math.max(1, n));
  }
  await prisma.bdOrgConfig.upsert({
    where: { organizationId: org.id },
    create: { organizationId: org.id, ...data },
    update: data,
  });
  revalidateAll();
}
