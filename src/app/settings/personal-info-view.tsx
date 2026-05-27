"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Save, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  resetProfilePicture,
  savePersonalInfo,
  uploadProfilePicture,
  type ProfilePictureStatus,
} from "@/app/settings/personal-info-actions";
import {
  TSHIRT_SIZES,
  type AddressFields,
  type PersonalInfoRow,
} from "@/app/settings/personal-info-constants";

// Address inputs deliberately match BrandingView's <Field>: rounded-lg
// outlined rectangle, subtle court-surface fill, brand focus ring.
// The earlier pattern (INPUT_FRAME_CLASS pill + grey fill) made the
// Address row look like a different control family from the Branding
// row directly below it. One settings page, one input style.
const ADDRESS_INPUT_CLASS =
  "block rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

// File picker is fed by a hidden <input type="file">. We read the file
// via FileReader as a base64 data URL on the client, strip the prefix,
// and POST the payload to the server action — exact same shape as the
// branding-logo uploader. PNG / JPG / WebP only; the server enforces
// the cap a second time.
const ACCEPTED_PROFILE_PICTURE_TYPES = "image/png,image/jpeg,image/webp";
const MAX_PROFILE_PICTURE_BYTES = 1_000_000;

export function PersonalInfoView({
  initial,
  picture,
  displayName,
}: {
  initial: PersonalInfoRow;
  picture: ProfilePictureStatus;
  displayName: string;
}) {
  const [birthday, setBirthday] = useState(initial.birthday ?? "");
  const [workAnniversary, setWorkAnniversary] = useState(
    initial.workAnniversary ?? "",
  );
  const [address, setAddress] = useState<AddressFields>(initial.address);
  const [tshirtSize, setTshirtSize] = useState(initial.tshirtSize ?? "");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function setAddressField<K extends keyof AddressFields>(
    field: K,
    value: AddressFields[K],
  ) {
    setAddress((prev) => ({ ...prev, [field]: value }));
  }

  // Profile-picture state. Lives in this view (not the personal-info
  // upsert form) because the upload flows through its own server
  // action with FormData-shaped input. Optimistic imageUrl drives the
  // preview between an upload finishing and useSession().update()
  // propagating the new URL into the topbar / sidebar.
  const router = useRouter();
  const { update: updateSession } = useSession();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(picture.imageUrl);
  const [hasCustom, setHasCustom] = useState<boolean>(picture.hasCustomPicture);
  const [imgFailed, setImgFailed] = useState(false);
  const [pictureBusy, setPictureBusy] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);

  function readFileAsBase64(file: File): Promise<{ mimeType: string; base64: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") {
          reject(new Error("File could not be read."));
          return;
        }
        // data URL → "data:image/png;base64,<payload>". Strip the
        // prefix so the server action receives just the base64 body.
        const commaIdx = result.indexOf(",");
        if (commaIdx < 0) {
          reject(new Error("Unexpected file payload."));
          return;
        }
        resolve({ mimeType: file.type, base64: result.slice(commaIdx + 1) });
      };
      reader.onerror = () => reject(reader.error ?? new Error("File read failed."));
      reader.readAsDataURL(file);
    });
  }

  async function handlePictureFile(file: File) {
    setPictureError(null);
    if (!file.type.startsWith("image/")) {
      setPictureError("Pick a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > MAX_PROFILE_PICTURE_BYTES) {
      setPictureError(
        `Image is ${Math.round(file.size / 1024)}KB. Max is ${MAX_PROFILE_PICTURE_BYTES / 1024}KB.`,
      );
      return;
    }
    setPictureBusy(true);
    try {
      const { mimeType, base64 } = await readFileAsBase64(file);
      const res = await uploadProfilePicture({
        filename: file.name,
        mimeType,
        dataBase64: base64,
      });
      if (!res.ok) {
        setPictureError(res.error);
        return;
      }
      setImageUrl(res.value.imageUrl);
      setHasCustom(true);
      setImgFailed(false);
      // Push the new URL into the live NextAuth JWT so the topbar +
      // sidebar avatars refresh without a sign-out. The jwt callback
      // we taught to honor trigger==="update" picks it up.
      await updateSession({ image: res.value.imageUrl });
      // And refresh server-rendered surfaces (calendar team list,
      // event tile owner dots) so they pick up the new URL too.
      router.refresh();
    } catch (e) {
      setPictureError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setPictureBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleResetPicture() {
    setPictureError(null);
    setPictureBusy(true);
    try {
      const res = await resetProfilePicture();
      if (!res.ok) {
        setPictureError(res.error);
        return;
      }
      setImageUrl(null);
      setHasCustom(false);
      setImgFailed(false);
      await updateSession({ image: null });
      router.refresh();
    } finally {
      setPictureBusy(false);
    }
  }

  const initials = computeInitials(displayName);
  const showImage = Boolean(imageUrl) && !imgFailed;

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await savePersonalInfo({
        birthday: birthday || null,
        workAnniversary: workAnniversary || null,
        address,
        tshirtSize: tshirtSize || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedAt(Date.now());
    });
  }

  return (
    <div className="space-y-5">
      {/* Profile picture. Sits at the top because the avatar reads
          everywhere a user shows up (topbar, sidebar, calendar team
          list, event-tile owner dots) — making it visually first
          here mirrors that prominence. */}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-court-fg">
          Profile picture
        </legend>
        <div className="text-xs text-court-fg-muted">
          PNG, JPG, or WebP. Up to 1MB. Shows up everywhere your avatar
          appears across Ace.
        </div>
        <div className="mt-2 flex items-center gap-4">
          <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-court-brand/30 bg-court-brand-tint text-base font-semibold text-court-brand-dark">
            {showImage && imageUrl ? (
              // Plain <img> here (not next/image) because the URL
              // varies between /api/avatar/... (same-origin) and a
              // Google googleusercontent URL — and we already pay the
              // 5-min CDN cache on the same-origin path. next/image
              // wouldn't add real value at 64px.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={displayName}
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
              />
            ) : (
              <span>{initials}</span>
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pictureBusy}
              className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
            >
              {pictureBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {hasCustom ? "Replace photo" : "Upload photo"}
            </button>
            {hasCustom && (
              <button
                type="button"
                onClick={handleResetPicture}
                disabled={pictureBusy}
                className="inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-3 py-1.5 text-xs font-semibold text-court-fg-muted shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Use default photo
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_PROFILE_PICTURE_TYPES}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handlePictureFile(file);
            }}
          />
        </div>
        {pictureError && (
          <p className="text-xs text-red-600">{pictureError}</p>
        )}
      </fieldset>

      <Field label="Birthday">
        <input
          type="date"
          value={birthday}
          onChange={(e) => setBirthday(e.target.value)}
          // Date inputs render their own fixed-width MM/DD/YYYY UI;
          // there's no upside to letting the chrome span the full
          // form width. Cap at ~180px so the field reads as a
          // compact picker, matching how every other date picker in
          // Ace is sized (event drawer, reminder form, etc.).
          className="block w-[180px] rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-court-accent focus:outline-none focus:ring-1 focus:ring-court-accent"
        />
      </Field>

      <Field
        label="Start date"
        hint="When you joined BreakPoint. Drives future anniversary pills."
      >
        <input
          type="date"
          value={workAnniversary}
          onChange={(e) => setWorkAnniversary(e.target.value)}
          className="block w-[180px] rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-court-accent focus:outline-none focus:ring-1 focus:ring-court-accent"
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-court-fg">
          Address
        </legend>
        <SubField label="Street">
          {/* Street/city kept at w-80 / w-56 from the prior pass so
              short values like "123 Main St" / "Solon" don't sit next
              to a giant empty bar. Styling now mirrors BrandingView
              (rounded-lg + outlined, not pill + grey-filled). */}
          <input
            type="text"
            value={address.street}
            onChange={(e) => setAddressField("street", e.target.value)}
            placeholder="123 Main St"
            className={`${ADDRESS_INPUT_CLASS} w-80 max-w-full`}
          />
        </SubField>
        <div className="flex flex-wrap items-end gap-3">
          <SubField label="City">
            <input
              type="text"
              value={address.city}
              onChange={(e) => setAddressField("city", e.target.value)}
              placeholder="Solon"
              className={`${ADDRESS_INPUT_CLASS} w-56 max-w-full`}
            />
          </SubField>
          <SubField label="State">
            <input
              type="text"
              value={address.state}
              onChange={(e) => setAddressField("state", e.target.value)}
              placeholder="OH"
              maxLength={32}
              className={`${ADDRESS_INPUT_CLASS} w-20 uppercase`}
            />
          </SubField>
          <SubField label="ZIP">
            <input
              type="text"
              value={address.zip}
              onChange={(e) => setAddressField("zip", e.target.value)}
              placeholder="44139"
              inputMode="numeric"
              maxLength={10}
              className={`${ADDRESS_INPUT_CLASS} w-28 tabular-nums`}
            />
          </SubField>
        </div>
      </fieldset>

      <Field label="T-Shirt Size">
        <select
          value={tshirtSize}
          onChange={(e) => setTshirtSize(e.target.value)}
          // Sizes are at most "3XL" — three characters wide. A
          // full-row select looked like a misuse of the form so it
          // shrinks to a compact ~90px control that fits the value
          // plus the disclosure arrow without empty space.
          className="block w-[90px] rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg focus:border-court-accent focus:outline-none focus:ring-1 focus:ring-court-accent"
        >
          <option value="">—</option>
          {TSHIRT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </Field>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </button>
        {savedAt && !pending && !error && (
          <span className="text-xs text-court-fg-muted">Saved.</span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-semibold text-court-fg">{label}</div>
      {hint && <div className="mb-1.5 text-xs text-court-fg-muted">{hint}</div>}
      {children}
    </label>
  );
}

function SubField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-court-fg-muted">
        {label}
      </div>
      {children}
    </label>
  );
}

// First+last initials from a display name (falling back to first
// letter, then "?"). Local copy of the same helper UserAvatarMenu
// uses — duplicated rather than imported because the calling
// shape is slightly different (one string vs. {name,email}).
function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return "?";
}
