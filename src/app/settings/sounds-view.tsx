"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
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
// independent selectors (Mail, SMS/Calls) so the recruiter can give
// each channel a distinct cue. Selecting an option immediately writes
// to localStorage and previews the sound; the explicit Preview button
// is there for clicking through options without re-selecting.

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
      <div className="border-t border-court-border" />
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
  return (
    <div>
      <div className="mb-2">
        <div className="text-sm font-semibold text-court-fg">{title}</div>
        <div className="mt-0.5 text-xs text-court-fg-muted">{description}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {SOUND_OPTIONS.map((opt) => {
          const active = opt.id === value;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onPick(opt.id)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition",
                active
                  ? "border-court-accent bg-court-accent-tint text-court-accent-dark shadow-sm"
                  : "border-court-border bg-court-surface-subtle/40 text-court-fg hover:bg-court-surface-subtle",
              )}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-sm font-semibold">{opt.label}</span>
                {opt.id !== "off" ? (
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Preview ${opt.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      playSound(opt.id);
                    }}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-court-border bg-court-surface text-court-fg-muted transition hover:text-court-fg"
                  >
                    <Play className="h-2.5 w-2.5" />
                  </span>
                ) : null}
              </div>
              <div className="text-[11px] text-court-fg-muted">{opt.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
