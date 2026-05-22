"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import {
  DEFAULT_MAIL_SOUND,
  DEFAULT_SMS_SOUND,
  MAIL_SOUND_KEY,
  SMS_SOUND_KEY,
  SOUND_OPTIONS,
  playSound,
  readSoundPref,
  writeSoundPref,
  type SoundId,
} from "@/lib/notification-sound";

// Ace 28.0 — Settings UI for the per-channel notification sound. Two
// independent dropdowns (Mail, SMS/Calls) so the recruiter can give
// each channel a distinct cue. Selecting an option immediately writes
// to localStorage and previews the sound; the explicit Preview button
// lets them re-hear the current selection without having to reselect.

export function NotificationSoundsView() {
  // Hydrate from localStorage on mount. Default values render server-
  // side and on the first paint so the picker is never blank.
  const [mailSound, setMailSound] = useState<SoundId>(DEFAULT_MAIL_SOUND);
  const [smsSound, setSmsSound] = useState<SoundId>(DEFAULT_SMS_SOUND);

  useEffect(() => {
    setMailSound(readSoundPref(MAIL_SOUND_KEY, DEFAULT_MAIL_SOUND));
    setSmsSound(readSoundPref(SMS_SOUND_KEY, DEFAULT_SMS_SOUND));
  }, []);

  function pickMail(next: SoundId) {
    setMailSound(next);
    writeSoundPref(MAIL_SOUND_KEY, next);
    playSound(next);
  }
  function pickSms(next: SoundId) {
    setSmsSound(next);
    writeSoundPref(SMS_SOUND_KEY, next);
    playSound(next);
  }

  return (
    <div className="space-y-5">
      <SoundSelector
        title="Mail"
        description="Plays when a new email lands in your inbox."
        value={mailSound}
        onPick={pickMail}
      />
      <SoundSelector
        title="Texts & Calls"
        description="Plays when a new Quo text or call event arrives."
        value={smsSound}
        onPick={pickSms}
      />
    </div>
  );
}

function SoundSelector({
  title,
  description,
  value,
  onPick,
}: {
  title: string;
  description: string;
  value: SoundId;
  onPick: (next: SoundId) => void;
}) {
  const selected = SOUND_OPTIONS.find((o) => o.id === value);
  return (
    <div>
      <div className="mb-2">
        <div className="text-sm font-semibold text-court-fg">{title}</div>
        <div className="mt-0.5 text-xs text-court-fg-muted">{description}</div>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={value}
          onChange={(e) => onPick(e.target.value as SoundId)}
          className="h-9 min-w-0 flex-1 rounded-lg border border-court-border bg-court-surface px-3 text-sm text-court-fg shadow-sm transition focus:border-court-accent focus:outline-none focus:ring-1 focus:ring-court-accent sm:flex-none sm:w-64"
        >
          {SOUND_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => playSound(value)}
          disabled={value === "off"}
          aria-label={`Preview ${selected?.label ?? "sound"}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-court-border bg-court-surface-subtle px-3 text-xs font-semibold text-court-fg transition hover:bg-court-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-3 w-3" />
          Preview
        </button>
      </div>
      {selected && selected.id !== "off" && (
        <div className="mt-1.5 text-[11px] text-court-fg-muted">
          {selected.description}
        </div>
      )}
    </div>
  );
}
