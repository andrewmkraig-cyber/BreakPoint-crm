"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_RULES } from "@/lib/personal-trainer-seed";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

export type PersonalTrainerRuleRow = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

async function requireSession(): Promise<boolean> {
  const s = await getServerSession(authOptions);
  return Boolean(s?.user?.email);
}

// All rules for an org, oldest first. Stable ordering so the seeded
// defaults always show at the top and recruiter-added rules pile up
// below them.
export async function getRules(orgId: string): Promise<PersonalTrainerRuleRow[]> {
  if (!(await requireSession())) return [];
  const rows = await prisma.personalTrainerRule.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

// Idempotent first-load seed. Counts existing rows; if zero, batch-
// inserts DEFAULT_RULES with monotonically increasing createdAt so the
// list renders in the same order they're declared in the seed file
// (otherwise createMany would tie them all to the same instant and
// fall back to id-order rendering).
export async function seedDefaultRules(orgId: string): Promise<Result<{ created: number }>> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  try {
    const existing = await prisma.personalTrainerRule.count({
      where: { organizationId: orgId },
    });
    if (existing > 0) return { ok: true, value: { created: 0 } };

    const now = Date.now();
    await prisma.personalTrainerRule.createMany({
      data: DEFAULT_RULES.map((text, idx) => ({
        organizationId: orgId,
        text,
        createdAt: new Date(now + idx),
      })),
    });
    revalidatePath("/settings");
    return { ok: true, value: { created: DEFAULT_RULES.length } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to seed rules." };
  }
}

export async function addRule(orgId: string, text: string): Promise<Result<{ id: string }>> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Rule text is required." };
  try {
    const row = await prisma.personalTrainerRule.create({
      data: { organizationId: orgId, text: trimmed },
      select: { id: true },
    });
    revalidatePath("/settings");
    void syncToGitHub(orgId);
    return { ok: true, value: { id: row.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to add rule." };
  }
}

export async function updateRule(
  orgId: string,
  id: string,
  text: string,
): Promise<Result> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Rule text is required." };
  try {
    const result = await prisma.personalTrainerRule.updateMany({
      where: { id, organizationId: orgId },
      data: { text: trimmed },
    });
    if (result.count === 0) return { ok: false, error: "Rule not found." };
    revalidatePath("/settings");
    void syncToGitHub(orgId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update rule." };
  }
}

export async function deleteRule(orgId: string, id: string): Promise<Result> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  try {
    const result = await prisma.personalTrainerRule.deleteMany({
      where: { id, organizationId: orgId },
    });
    if (result.count === 0) return { ok: false, error: "Rule not found." };
    revalidatePath("/settings");
    void syncToGitHub(orgId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete rule." };
  }
}

// Mirror the org's active rules into docs/ace/PERSONAL_TRAINER.md on
// the canonical GitHub repo. Neon is the source of truth — this is a
// visibility convenience, so any failure (missing token, network blip,
// 4xx, 5xx) is swallowed silently. The action that triggered the sync
// returns ok:true regardless.
//
// GET first to capture the file's current sha (required for PUT to
// avoid clobbering concurrent edits), rebuild the markdown body from
// the latest Neon rows, then PUT with sha attached.
const GITHUB_REPO_OWNER = "andrewmkraig-cyber";
const GITHUB_REPO_NAME = "BreakPoint-crm";
const GITHUB_FILE_PATH = "docs/ace/PERSONAL_TRAINER.md";

async function syncToGitHub(orgId: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return; // No token configured — skip silently.

  try {
    const rules = await prisma.personalTrainerRule.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "asc" },
      select: { text: true },
    });
    const isoNow = new Date().toISOString();
    const body =
      `# Personal Trainer Rules\n` +
      `Last updated: ${isoNow}\n\n` +
      rules.map((r, i) => `${i + 1}. ${r.text}`).join("\n") +
      `\n`;

    const apiBase = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/${GITHUB_FILE_PATH}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    let sha: string | undefined;
    const getRes = await fetch(apiBase, { headers, cache: "no-store" });
    if (getRes.ok) {
      const json = (await getRes.json()) as { sha?: string };
      if (typeof json.sha === "string") sha = json.sha;
    } else if (getRes.status !== 404) {
      // Anything other than file-missing is unexpected; bail quietly.
      return;
    }

    const contentB64 = Buffer.from(body, "utf-8").toString("base64");
    await fetch(apiBase, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `chore: sync Personal Trainer rules (${rules.length})`,
        content: contentB64,
        ...(sha ? { sha } : {}),
      }),
      cache: "no-store",
    });
  } catch {
    // Silent fail per spec — Neon is source of truth.
  }
}
