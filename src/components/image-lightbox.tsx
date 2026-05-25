"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { toast } from "sonner";

// Full-screen image viewer for MMS attachments. Clicking an attachment
// thumbnail used to open the raw storage.googleapis.com URL in a new tab,
// which on the iOS PWA renders as a blank in-app browser (the object is
// served with an attachment content-disposition, so Safari tries to
// download it and shows nothing) and on desktop force-downloads the file.
// Neither lets the recruiter just LOOK at the picture. This renders the
// bytes inline in an <img> - which works on every platform regardless of
// content-disposition (the bubble thumbnail already proves the URL loads
// in an <img>) - and offers an explicit Save affordance.
//
// Portaled to <body> so the overlay escapes any transformed / backdrop-
// blurred ancestor (the Liquid Glass surfaces use backdrop-filter, which
// would otherwise become the containing block for position: fixed).
export function ImageLightbox({
  src,
  alt = "Image attachment",
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape to close + lock background scroll while open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  async function handleSave() {
    // iOS PWAs can't programmatically write to the camera roll, so point
    // the user at the native gesture rather than opening the raw storage
    // URL (which is the blank-tab bug this component exists to avoid).
    const isTouch =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches;
    if (isTouch) {
      toast.info("Press and hold the photo to save it to your device.");
      return;
    }
    // Desktop: fetch the bytes and download via a blob URL so the saved
    // file keeps a sensible name. If the object isn't CORS-enabled the
    // fetch throws - fall back to letting the browser handle the URL
    // directly (downloads via the attachment disposition on desktop).
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = inferFilename(src, blob.type);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, "_blank", "noopener,noreferrer");
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={onClose}
      className="fixed inset-0 z-[1200] flex flex-col bg-black/90 backdrop-blur-sm"
    >
      <div className="flex shrink-0 items-center justify-end gap-2 p-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleSave();
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/20"
        >
          <Download className="h-4 w-4" />
          Save
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close image viewer"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/20 bg-white/10 text-white transition hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />
      </div>
    </div>,
    document.body,
  );
}

function inferFilename(src: string, mime: string): string {
  try {
    const last = new URL(src).pathname.split("/").pop() || "";
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
  } catch {
    // not a parseable URL - fall through to the mime-derived name
  }
  const ext = mime?.split("/")[1] || "jpg";
  return `mms-image.${ext}`;
}
