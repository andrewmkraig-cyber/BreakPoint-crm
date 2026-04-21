const BASE = 'https://app.krispcall.com/api/v3/platform/pipedream'
const KEY = process.env.KRISPCALL_API_KEY!
export const FROM = process.env.KRISPCALL_FROM_NUMBER!

function headers() {
  return {
    'Authorization': `Bearer ${KEY}`,
    'X-API-Key': KEY,
    'Content-Type': 'application/json',
  }
}

export async function sendSms(toNumber: string, body: string) {
  const res = await fetch(`${BASE}/sms/send`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ from_number: FROM, to_number: toNumber, content: body }),
  })
  if (!res.ok) throw new Error(`Krispcall SMS error: ${res.status}`)
  return res.json()
}

export async function getCallRecording(callId: string) {
  const res = await fetch(`${BASE}/calls/${callId}/recording`, { headers: headers() })
  if (!res.ok) return null
  return res.json()
}
