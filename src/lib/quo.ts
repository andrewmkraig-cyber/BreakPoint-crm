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

export async function sendSms(toNumber: string, body: string) {
  const res = await fetch(`${BASE}/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ content: body, from: FROM, to: [toNumber], phoneNumberId: PHONE_NUMBER_ID }),
  })
  if (!res.ok) throw new Error(`Quo SMS error: ${res.status}`)
  return res.json()
}

export async function getCallRecording(callId: string) {
  const res = await fetch(`${BASE}/calls/${callId}`, { headers: headers() })
  if (!res.ok) return null
  return res.json()
}
