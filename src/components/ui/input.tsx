// Shared input styling tokens. Two classes that pair with the
// .court-input-frame / .court-input-control rules in globals.css:
//
//   INPUT_FRAME_CLASS   → the pill wrapper. Carries the surface, border,
//                         and the :focus-within glow (brand-tinted border,
//                         brand ring, soft halo, 1px lift) so the whole
//                         frame reacts when the inner field is focused.
//   INPUT_CONTROL_CLASS → the inner field. Transparent + borderless, fills
//                         the frame; works for <input> and <textarea> alike.
//
// Usage:
//   <div className={INPUT_FRAME_CLASS}>
//     <input className={INPUT_CONTROL_CLASS} />
//   </div>
// Append icon-clearance / sizing utilities to either as needed, e.g.
//   <input className={`${INPUT_CONTROL_CLASS} pl-10 pr-10 text-sm`} />
//
// Most callers should reach for the shared <Input> / <Textarea> / <Select>
// components below rather than wiring the raw classes by hand — those wrap
// this exact frame + control (the rectangular court-input-rect standard) and
// add an optional label + error message. The raw constants stay exported for
// the pill surfaces (search bar / SMS composer / Ace Assistant) and any field
// that needs the frame without the component shell.
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const INPUT_FRAME_CLASS = "court-input-frame";

// Rectangular frame variant — same surface / border / focus glow as
// INPUT_FRAME_CLASS, but .court-input-rect squares the pill off to a 0.75rem
// radius. Used by the New Candidate / Job / Client forms.
export const INPUT_FRAME_RECT_CLASS = "court-input-frame court-input-rect";

export const INPUT_CONTROL_CLASS = "court-input-control";

// --- Shared field components (Ace 91.0) -----------------------------------
// Drop-in replacements for hand-rolled form inputs. Each renders the EXACT
// rectangular court-input-rect frame + control above — no new styling — plus
// an optional label and inline error message. They spread every native prop
// straight through to the underlying element, so value / onChange / disabled /
// rows / type / refs / data-* all behave identically to a raw control.
//
// The outer wrapper is a <div>, never a <label>, so these compose cleanly
// inside callers that already supply their own <label> / Field / Row chrome
// (which is most composer surfaces) without producing nested <label> markup.
// Pass `label` only when the field owns its own label.

const FIELD_LABEL_CLASS =
  "mb-1 block text-xs uppercase tracking-wide text-court-fg-muted";
const FIELD_ERROR_CLASS = "mt-1 block text-[11px] font-medium text-red-700";
// Matches the inline-error treatment the New Job CompactField uses.
const ERROR_FRAME_CLASS = "border-red-300 bg-red-50";

type SharedFieldProps = {
  // Optional label rendered above the frame. Omit when a parent wrapper
  // already supplies the label (Field / Row / a sibling <label>).
  label?: React.ReactNode;
  // Optional inline error message rendered below the frame; when set, the
  // frame also takes the red error treatment.
  error?: string | null;
  // Extra classes for the outer wrapper <div> (width, flex sizing, spacing).
  containerClassName?: string;
  // Extra classes for the rect frame (height, min-w-0, etc).
  frameClassName?: string;
  // Extra classes for the label <span>.
  labelClassName?: string;
};

function hasError(error?: string | null): boolean {
  return error != null && error !== "";
}

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    SharedFieldProps {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    { label, error, containerClassName, frameClassName, labelClassName, className, ...props },
    ref,
  ) {
    return (
      <div className={containerClassName}>
        {label != null && (
          <span className={cn(FIELD_LABEL_CLASS, labelClassName)}>{label}</span>
        )}
        <div
          className={cn(
            INPUT_FRAME_RECT_CLASS,
            "w-full",
            hasError(error) && ERROR_FRAME_CLASS,
            frameClassName,
          )}
        >
          <input ref={ref} className={cn(INPUT_CONTROL_CLASS, "text-sm", className)} {...props} />
        </div>
        {hasError(error) && <span className={FIELD_ERROR_CLASS}>{error}</span>}
      </div>
    );
  },
);

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    SharedFieldProps {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, error, containerClassName, frameClassName, labelClassName, className, ...props },
    ref,
  ) {
    return (
      <div className={containerClassName}>
        {label != null && (
          <span className={cn(FIELD_LABEL_CLASS, labelClassName)}>{label}</span>
        )}
        {/* items-stretch so a multi-row / fill-height textarea fills the frame
            instead of being vertically centered the way a single-line input is. */}
        <div
          className={cn(
            INPUT_FRAME_RECT_CLASS,
            "w-full items-stretch",
            hasError(error) && ERROR_FRAME_CLASS,
            frameClassName,
          )}
        >
          <textarea ref={ref} className={cn(INPUT_CONTROL_CLASS, "text-sm", className)} {...props} />
        </div>
        {hasError(error) && <span className={FIELD_ERROR_CLASS}>{error}</span>}
      </div>
    );
  },
);

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement>,
    SharedFieldProps {}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    { label, error, containerClassName, frameClassName, labelClassName, className, children, ...props },
    ref,
  ) {
    // court-input-control sets appearance:none, which strips the OS dropdown
    // arrow, so a single-select renders its own ChevronDown (matching the
    // bespoke composer selects). A multi-row list box (size > 1 / multiple)
    // keeps its native list and gets no chevron + no extra right padding.
    const isListbox =
      props.multiple === true || (typeof props.size === "number" && props.size > 1);
    return (
      <div className={containerClassName}>
        {label != null && (
          <span className={cn(FIELD_LABEL_CLASS, labelClassName)}>{label}</span>
        )}
        <div
          className={cn(
            INPUT_FRAME_RECT_CLASS,
            "relative w-full",
            hasError(error) && ERROR_FRAME_CLASS,
            frameClassName,
          )}
        >
          <select
            ref={ref}
            className={cn(INPUT_CONTROL_CLASS, "text-sm", !isListbox && "pr-8", className)}
            {...props}
          >
            {children}
          </select>
          {!isListbox && (
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted"
            />
          )}
        </div>
        {hasError(error) && <span className={FIELD_ERROR_CLASS}>{error}</span>}
      </div>
    );
  },
);
