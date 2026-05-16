const BASE = 'https://api.openphone.com/v1'
const KEY = process.env.QUO_API_KEY!
export const FROM = process.env.QUO_FROM_NUMBER!
const PHONE_NUMBER_ID = process.env.QUO_PHONE_NUMBER_ID!

function headers() {
  return {
    'Authorization': KEY,
    'Content-Type': 'application/json',
  }
}

// Structured send result. The route handler needs the parsed body + HTTP
// status so it can log them and downgrade the persisted row to status=
// 'failed' when OpenPhone returns 2xx but data.status reports a
// non-success state (undelivered / failed). Throwing on non-2xx like the
// old shape did made every silent OpenPhone reject look identical to a
// successful send in Vercel logs.
export type QuoSendResult = {
  ok: boolean
  httpStatus: number
  // OpenPhone's documented success envelope is { data: { id, status, ... } };
  // we keep the raw parsed body so the route can dump it to logs verbatim.
  body: unknown
  messageId: string | null
  // OpenPhone delivery state at the moment of the API response. Usually
  // "queued" / "sent" for accepted messages; "undelivered" / "failed" for
  // rejected ones. Null when the response body didn't carry data.status.
  providerStatus: string | null
  // Surfaced error message when OpenPhone responds with a non-2xx or a
  // 2xx whose body indicates failure. Used to populate the API response
  // shown back to the composer.
  errorMessage: string | null
}

export async function sendSms(
  toNumber: string,
  body: string,
): Promise<QuoSendResult> {
  if (!FROM) {
    const msg =
      'QUO_FROM_NUMBER env var is not set — refusing to dispatch without a registered from-number'
    console.error('[lib/quo sendSms]', msg)
    return {
      ok: false,
      httpStatus: 0,
      body: null,
      messageId: null,
      providerStatus: null,
      errorMessage: msg,
    }
  }

  const payload = {
    content: body,
    from: FROM,
    to: [toNumber],
    phoneNumberId: PHONE_NUMBER_ID,
  }
  // Log the outbound payload (without the API key) so Vercel logs show
  // exactly what we asked OpenPhone to send — the most common silent
  // failure has been an unnormalized to-number sneaking through.
  console.log(
    `[lib/quo sendSms] dispatch to=${toNumber} from=${FROM} phoneNumberId=${PHONE_NUMBER_ID ? 'set' : 'unset'} contentLen=${body.length}`,
  )

  const res = await fetch(`${BASE}/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  })

  const parsed = await res.json().catch(() => null)
  // Dump the response verbatim. JSON.stringify keeps it on one line so
  // Vercel's log search can grep for "[lib/quo sendSms] response".
  console.log(
    `[lib/quo sendSms] response http=${res.status} body=${JSON.stringify(parsed)}`,
  )

  const dataObj =
    parsed && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)
      ? ((parsed as { data?: unknown }).data as Record<string, unknown> | undefined)
      : undefined
  const messageId =
    dataObj && typeof dataObj.id === 'string' ? (dataObj.id as string) : null
  const providerStatus =
    dataObj && typeof dataObj.status === 'string'
      ? (dataObj.status as string)
      : null

  if (!res.ok) {
    const apiMsg =
      parsed && typeof parsed === 'object'
        ? ((parsed as { message?: string }).message ?? null)
        : null
    return {
      ok: false,
      httpStatus: res.status,
      body: parsed,
      messageId,
      providerStatus,
      errorMessage: apiMsg ?? `OpenPhone HTTP ${res.status}`,
    }
  }

  // OpenPhone returns 2xx for accepted messages even when downstream
  // delivery is doomed; "undelivered" / "failed" come back synchronously
  // for hard rejects (e.g. unregistered 10DLC, blocked recipient). Treat
  // them as send failures so the UI doesn't lie about delivery.
  const hardFail = providerStatus === 'undelivered' || providerStatus === 'failed'
  return {
    ok: !hardFail,
    httpStatus: res.status,
    body: parsed,
    messageId,
    providerStatus,
    errorMessage: hardFail
      ? `OpenPhone reported status="${providerStatus}"`
      : null,
  }
}

export async function getCallRecording(callId: string) {
  const res = await fetch(`${BASE}/calls/${callId}`, { headers: headers() })
  if (!res.ok) return null
  return res.json()
}
