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
export const INPUT_FRAME_CLASS = "court-input-frame";

// Rectangular frame variant — same surface / border / focus glow as
// INPUT_FRAME_CLASS, but .court-input-rect squares the pill off to a 0.75rem
// radius. Used by the New Candidate / Job / Client forms.
export const INPUT_FRAME_RECT_CLASS = "court-input-frame court-input-rect";

export const INPUT_CONTROL_CLASS = "court-input-control";
