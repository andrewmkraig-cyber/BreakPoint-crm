"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Save, Upload, Trash2, Copy } from "lucide-react";
import {
  resetBrandingLogo,
  saveBrandingFields,
  uploadBrandingLogo,
} from "@/app/settings/branding-actions";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// Max matches MAX_LOGO_BYTES server-side — double-enforced so a user
// gets feedback before a 500KB+ file leaves the browser.
const MAX_LOGO_KB = 500;

export type BrandingInitial = {
  email: string;
  fullName: string;
  jobTitle: string;
  phone: string;
  website: string;
  logoPreviewDataUri: string; // full "data:<mime>;base64,..." or ""
  hasCustomLogo: boolean;
};

export function BrandingView({
  initial,
  signaturePreviewHtml,
  signaturePreviewText,
}: {
  initial: BrandingInitial;
  signaturePreviewHtml?: string;
  signaturePreviewText?: string;
}) {
  const [fullName, setFullName] = useState(initial.fullName);
  const [jobTitle, setJobTitle] = useState(initial.jobTitle);
  const [phone, setPhone] = useState(initial.phone);
  const [website, setWebsite] = useState(initial.website);
  const [logoPreview, setLogoPreview] = useState(initial.logoPreviewDataUri);
  const [hasCustomLogo, setHasCustomLogo] = useState(initial.hasCustomLogo);
  const [saving, startSaving] = useTransition();
  const [uploading, startUploading] = useTransition();
  const [resetting, startResetting] = useTransition();
  const [copying, setCopying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function onSave() {
    startSaving(async () => {
      const res = await saveBrandingFields({ fullName, jobTitle, phone, website });
      if (!res.ok) {
        toast.error("Couldn't save branding", { description: res.error });
        return;
      }
      toast.success("Branding saved");
    });
  }

  function onPickLogo() {
    fileInputRef.current?.click();
  }

  async function onLogoSelected(file: File) {
    if (file.size > MAX_LOGO_KB * 1024) {
      toast.error("Logo too large", {
        description: `Max ${MAX_LOGO_KB}KB. This file is ${Math.round(file.size / 1024)}KB.`,
      });
      return;
    }
    if (!/^image\/(png|jpeg|jpg)$/.test(file.type)) {
      toast.error("Wrong file type", {
        description: "PNG or JPG only.",
      });
      return;
    }
    const { dataBase64, dataUri } = await fileToBase64(file);
    startUploading(async () => {
      const res = await uploadBrandingLogo({
        filename: file.name,
        mimeType: file.type,
        dataBase64,
      });
      if (!res.ok) {
        toast.error("Upload failed", { description: res.error });
        return;
      }
      setLogoPreview(dataUri);
      setHasCustomLogo(true);
      toast.success("Logo updated");
    });
  }

  // Write both HTML and plain-text to the clipboard so Gmail compose
  // (which reads text/html) pastes the formatted signature, while
  // plain-text targets (text editors, signal-style chat) still get
  // a legible fallback. navigator.clipboard.write is the modern
  // multi-MIME path; we fall back to writeText(text) on older
  // browsers that don't support it.
  async function onCopy() {
    if (!signaturePreviewHtml) return;
    setCopying(true);
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const item = new ClipboardItem({
          "text/html": new Blob([signaturePreviewHtml], { type: "text/html" }),
          "text/plain": new Blob([signaturePreviewText ?? ""], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(signaturePreviewText ?? signaturePreviewHtml);
      } else {
        throw new Error("Clipboard API not available in this browser.");
      }
      toast.success("Signature copied", {
        description: "Paste it into Gmail's compose window (⌘V).",
      });
    } catch (e) {
      toast.error("Copy failed", {
        description: e instanceof Error ? e.message : "Browser blocked the clipboard write.",
      });
    } finally {
      setCopying(false);
    }
  }

  function onReset() {
    if (!hasCustomLogo) return;
    if (!confirm("Revert to the default BreakPoint logo?")) return;
    startResetting(async () => {
      const res = await resetBrandingLogo();
      if (!res.ok) {
        toast.error("Couldn't reset logo", { description: res.error });
        return;
      }
      // Force a hard reload so the server re-renders the default logo
      // preview — avoids shipping another API route just to hand back
      // the default bytes.
      toast.success("Logo reset to default");
      window.location.reload();
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name" value={fullName} onChange={setFullName} placeholder="Andrew Kraig" />
        <Field label="Job title" value={jobTitle} onChange={setJobTitle} placeholder="Managing Partner & Founder" />
        <Field label="Phone" value={phone} onChange={setPhone} placeholder="216-870-4655" />
        <Field label="Website" value={website} onChange={setWebsite} placeholder="www.breakpointtalent.com" />
        <Field label="Email" value={initial.email} onChange={() => {}} readOnly />
      </div>

      <div>
        <div className="mb-2 text-[11px] uppercase tracking-wider text-court-fg-muted">
          Signature logo
        </div>
        <div className="flex items-center gap-4">
          <div className="flex h-24 w-40 items-center justify-center rounded-lg border border-court-border bg-court-surface shadow-sm">
            {logoPreview ? (
              // The logo loads from an inline data: URI so this preview
              // matches exactly what recipients see in their inbox —
              // no external image loader, no CDN cache.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoPreview}
                alt="Signature logo preview"
                className="max-h-20 max-w-[140px] object-contain"
              />
            ) : (
              <span className="text-[11px] text-court-fg-muted">No logo</span>
            )}
          </div>
          <div className="flex flex-col gap-2 text-xs text-court-fg-muted">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onLogoSelected(file);
                e.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              onClick={onPickLogo}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg shadow-sm transition hover:text-brand-dark disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              Replace logo
            </button>
            {hasCustomLogo && (
              <button
                type="button"
                onClick={onReset}
                disabled={resetting}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-court-fg-muted transition hover:text-red-600 disabled:opacity-60"
              >
                {resetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                Reset to default
              </button>
            )}
            <span className="text-[10px] text-court-fg-muted">
              PNG or JPG, max {MAX_LOGO_KB}KB. Shown at 120px wide in signatures.
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </button>
      </div>

      {signaturePreviewHtml && (
        <div className="border-t border-court-border pt-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-wider text-court-fg-muted">
              Signature preview
            </div>
            <button
              type="button"
              onClick={onCopy}
              disabled={copying}
              className="inline-flex items-center gap-1.5 rounded-lg border border-court-border bg-court-surface px-3 py-1.5 text-xs font-medium text-court-fg shadow-sm transition hover:text-brand-dark disabled:opacity-60"
            >
              {copying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
              Copy signature
            </button>
          </div>
          <div className="text-xs text-court-fg-muted">
            What recipients see at the bottom of every email Ace sends. Copy
            pastes formatted HTML into Gmail compose. Save above to refresh the
            output.
          </div>
          <div
            className="mt-3 rounded-lg border border-court-border bg-white p-4"
            // The signature HTML is generated by renderSignatureHtml from
            // our own UserProfile row — same function /reply and /send
            // run through. Safe to inline; not user-supplied content.
            dangerouslySetInnerHTML={{ __html: signaturePreviewHtml }}
          />
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        placeholder={placeholder}
        frameClassName="mt-1"
        className={cn(readOnly && "cursor-not-allowed opacity-70")}
      />
    </label>
  );
}

function fileToBase64(file: File): Promise<{ dataUri: string; dataBase64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader did not return a string"));
        return;
      }
      const comma = result.indexOf(",");
      resolve({
        dataUri: result,
        dataBase64: comma >= 0 ? result.slice(comma + 1) : result,
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}
