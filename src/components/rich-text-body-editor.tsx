"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import LinkExtension from "@tiptap/extension-link";
import {
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Underline as UnderlineIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Tiptap-backed body editor used by the submittal composer (and any other
// composer that opts in via EmailComposer.richTextBody). Keystrokes Cmd/Ctrl+B
// and Cmd/Ctrl+U come free with StarterKit + Underline — no custom handler
// needed. The editor emits HTML on every change so the parent can stash the
// rendered <strong>/<u>/<p>/<br> structure directly into the Gmail message,
// which is what makes bold/underline show up in the recipient's inbox.
//
// Why Tiptap over a plain contentEditable: we need a predictable serialization
// (editor.getHTML()) and selection-preserving commands for the merge-field
// insert ("Insert Field" must splice a token at the caret without wrecking
// existing formatting). ProseMirror's doc model handles both cleanly; raw
// contentEditable + execCommand is deprecated and buggy across browsers.

export type RichTextBodyEditorHandle = {
  // Inserts plain text at the current selection. Used by the EmailComposer's
  // "Insert Field" dropdown so merge tokens like [CandidateFirstName] land
  // at the caret instead of being appended to the end.
  insertPlainText: (text: string) => void;
  // Replaces the entire editor content with HTML. Used after Claude generation
  // and template application, which produce full-body HTML.
  setHtml: (html: string) => void;
  // Replaces the entire content via a select-all + insertContent chain, so the
  // swap lands in ProseMirror's history stack and the user can Cmd+Z back to
  // their previous draft. Use this for "Edit with Claude" — setHtml is a
  // history-clearing reset and won't survive an undo.
  replaceWithUndo: (html: string) => void;
  // Pulls the current HTML snapshot. The parent already receives HTML via
  // onChange on every keystroke; this is a pull-model fallback if needed.
  getHtml: () => string;
};

type Props = {
  initialHtml: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  showToolbar?: boolean;
  // Autosaved subject+body state outside the editor may restore a value that's
  // different from `initialHtml`. When `value` changes externally (e.g. after
  // a template pick or Claude generation rewrote state), the editor content is
  // re-synced to it. Without this sync Tiptap clings to its own internal doc
  // and template picks appear to "do nothing."
  value?: string;
};

export const RichTextBodyEditor = forwardRef<RichTextBodyEditorHandle, Props>(
  function RichTextBodyEditor(
    { initialHtml, onChange, placeholder, className, showToolbar = false, value },
    ref,
  ) {
    const [, setToolbarTick] = useState(0);
    const refreshToolbar = () => setToolbarTick((tick) => tick + 1);

    const editor = useEditor({
      extensions: [
        // history, bold, italic, strike, paragraph, bulletList, etc. all come from StarterKit
        StarterKit.configure({
          // Drop the heading menu — submittals use inline bold only, and
          // allowing h1/h2/h3 would let recruiters accidentally create huge
          // headers in an otherwise paragraph-oriented email body.
          heading: false,
          // Code/codeblock aren't relevant for email bodies either.
          code: false,
          codeBlock: false,
          horizontalRule: false,
        }),
        Underline,
        LinkExtension.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      ],
      content: initialHtml,
      onUpdate: ({ editor }) => {
        onChange(editor.getHTML());
        refreshToolbar();
      },
      onSelectionUpdate: refreshToolbar,
      editorProps: {
        attributes: {
          class: cn(
            "min-h-[280px] w-full resize-vertical whitespace-pre-wrap px-3 py-2 font-sans text-sm leading-relaxed text-court-fg outline-none",
            "prose prose-sm max-w-none prose-p:my-2 prose-strong:font-semibold",
            "[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
            showToolbar
              ? "border-0 bg-transparent"
              : "rounded-lg border border-court-border bg-court-surface focus:border-brand focus:ring-2 focus:ring-brand/20",
            className,
          ),
          ...(placeholder ? { "data-placeholder": placeholder } : {}),
        },
      },
      // SSR-safe: immediatelyRender: false prevents a hydration mismatch when
      // the initialHtml is empty and the client-rendered editor wraps it in
      // a ProseMirror-managed <p></p> that the server HTML didn't have.
      immediatelyRender: false,
    });

    // When an external force replaces `value` (template apply / Claude), push
    // it into the editor. Guard with a getHTML equality check so typing in the
    // editor (which also triggers parent re-renders via onUpdate) doesn't cause
    // a feedback loop of setContent calls.
    useEffect(() => {
      if (!editor || value === undefined) return;
      if (editor.getHTML() === value) return;
      editor.commands.setContent(value, false);
    }, [editor, value]);

    useImperativeHandle(
      ref,
      () => ({
        insertPlainText(text: string) {
          editor?.chain().focus().insertContent(text).run();
        },
        setHtml(html: string) {
          editor?.commands.setContent(html, true);
        },
        replaceWithUndo(html: string) {
          // chain().focus().selectAll().insertContent(...) routes through
          // a single ProseMirror transaction that's pushed onto the history
          // stack; Cmd+Z then restores the prior doc. Plain setContent is
          // a state replacement that wipes history.
          editor?.chain().focus().selectAll().insertContent(html).run();
        },
        getHtml() {
          return editor?.getHTML() ?? "";
        },
      }),
      [editor],
    );

    if (showToolbar) {
      return (
        <div className="overflow-hidden rounded-lg border border-court-border bg-court-surface focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
          <RichTextToolbar editor={editor} />
          <EditorContent editor={editor} />
        </div>
      );
    }

    return <EditorContent editor={editor} />;
  },
);

function RichTextToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) {
    return <div className="h-9 border-b border-court-border/50 bg-court-surface-subtle/40" />;
  }

  const btn = (active: boolean, onClick: () => void, icon: JSX.Element, label: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "rounded-md px-2 py-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg",
        active && "bg-court-accent-tint/60 text-court-accent-dark",
      )}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-court-border/50 bg-court-surface-subtle/40 px-3 py-1">
      {btn(
        editor.isActive("bold"),
        () => editor.chain().focus().toggleBold().run(),
        <Bold className="h-3.5 w-3.5" />,
        "Bold",
      )}
      {btn(
        editor.isActive("italic"),
        () => editor.chain().focus().toggleItalic().run(),
        <Italic className="h-3.5 w-3.5" />,
        "Italic",
      )}
      {btn(
        editor.isActive("underline"),
        () => editor.chain().focus().toggleUnderline().run(),
        <UnderlineIcon className="h-3.5 w-3.5" />,
        "Underline",
      )}
      <div className="mx-1 h-4 w-px bg-court-border" />
      {btn(
        editor.isActive("bulletList"),
        () => editor.chain().focus().toggleBulletList().run(),
        <List className="h-3.5 w-3.5" />,
        "Bulleted list",
      )}
      {btn(
        editor.isActive("orderedList"),
        () => editor.chain().focus().toggleOrderedList().run(),
        <ListOrdered className="h-3.5 w-3.5" />,
        "Numbered list",
      )}
      <div className="mx-1 h-4 w-px bg-court-border" />
      {btn(
        editor.isActive("link"),
        () => {
          if (editor.isActive("link")) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          const url = window.prompt("Link URL");
          if (!url) return;
          editor.chain().focus().setLink({ href: url }).run();
        },
        <LinkIcon className="h-3.5 w-3.5" />,
        "Link",
      )}
    </div>
  );
}
