/**
 * One-off controlled live test for the Apollo BD enroll path.
 *
 * Calls apolloEnrollContact directly (the same single-contact primitive
 * the BD run uses) with a SAFE test contact — Andrew's own address — so
 * nothing reaches a real prospect. Makes ONE real Apollo API call.
 *
 * It sends NO email as long as the Apollo sequence itself is not
 * activated in Apollo (Ace only asks Apollo to enroll the contact; the
 * actual send is gated by the sequence's activation state in Apollo).
 *
 * Run (key never touches the repo — pull prod env to a tmp file first):
 *   node_modules/.bin/vercel env pull --environment=production --yes /tmp/ace-prod.env
 *   set -a; . /tmp/ace-prod.env; set +a
 *   node_modules/.bin/tsx scripts/test-apollo-enroll.ts
 *   rm -f /tmp/ace-prod.env
 *
 * Leave this script in place for now; it is inert unless run with the
 * prod APOLLO_API_KEY present in the environment.
 */
import { apolloEnrollContact, type EnrollPayload } from "@/lib/bd/apollo-enroll";
import { getDefaultApolloSequence } from "@/lib/bd/apollo-sequences";

// Hardcoded test values — these populate the three real Apollo custom
// field IDs so we can confirm the mapping end-to-end.
const TEST_JOB_TITLE = "Tax Manager";
const TEST_JOB_URL = "https://example.com/job/123";
const TEST_JOB_LOCATION = "Chicago, Illinois";

const FIELD_ID_JOB_TITLE = "6a207e120239f0000c18decd";
const FIELD_ID_JOB_URL = "6a207e2290a45c00208eccbb";
const FIELD_ID_JOB_CITY = "6a207f8bc3715c0010ae118e";

async function main() {
  const apiKey = process.env.APOLLO_API_KEY;
  const sequenceId =
    process.env.APOLLO_SEQUENCE_ID ?? getDefaultApolloSequence()?.apolloId ?? "";

  if (!apiKey) {
    console.error(
      "[test] APOLLO_API_KEY not set. Pull prod env first (see header) — aborting, no API call made.",
    );
    process.exit(1);
  }
  if (!sequenceId) {
    console.error("[test] No sequence id resolved — aborting.");
    process.exit(1);
  }

  const payload: EnrollPayload = {
    first_name: "Andrew",
    last_name: "Kraig",
    email: "andrew@breakpoint-talent.com",
    title: "BD Enroll Test",
    organization_name: "BreakPoint Talent (BD field test)",
    typed_custom_fields: {
      [FIELD_ID_JOB_TITLE]: TEST_JOB_TITLE,
      [FIELD_ID_JOB_URL]: TEST_JOB_URL,
      [FIELD_ID_JOB_CITY]: TEST_JOB_LOCATION,
    },
  };

  console.log("[test] enrolling test contact:", payload.email);
  console.log("[test] sequence_id:", sequenceId);
  console.log(
    "[test] expected typed_custom_fields:",
    JSON.stringify(payload.typed_custom_fields),
  );

  const ok = await apolloEnrollContact(apiKey, sequenceId, payload);

  console.log(`[test] apolloEnrollContact returned: ${ok}`);
  if (!ok) {
    console.error(
      "[test] enroll reported failure — see the [Apollo] enroll contact warn line above for status/body.",
    );
    process.exit(2);
  }
  console.log(
    "[test] enroll succeeded. Now fetch the contact back from Apollo and read typed_custom_fields to confirm the three IDs hold the test values.",
  );
}

main().catch((err) => {
  console.error("[test] threw:", err instanceof Error ? err.message : err);
  process.exit(3);
});
