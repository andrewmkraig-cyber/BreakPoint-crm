export type Attachments = {
  candidateIds: string[];
  clientIds: string[];
  jobIds: string[];
};

export type NoteActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type CreateNoteInput = {
  title?: string | null;
  body: string;
  attach?: Partial<Attachments> | null;
};

export type UpdateNoteInput = {
  id: string;
  title?: string | null;
  body?: string;
};

export type AttachNoteInput = {
  id: string;
  attach: Partial<Attachments>;
};

export type AttachOption = {
  id: string;
  label: string;
  sublabel: string | null;
};

export type AttachOptionsResult =
  | { ok: true; options: AttachOption[] }
  | { ok: false; error: string };

export type ResolvedSelection = {
  candidates: Array<{ id: string; label: string }>;
  clients: Array<{ id: string; label: string }>;
  jobs: Array<{ id: string; label: string }>;
};

export type ResolveSelectionResult =
  | { ok: true; selection: ResolvedSelection }
  | { ok: false; error: string };
