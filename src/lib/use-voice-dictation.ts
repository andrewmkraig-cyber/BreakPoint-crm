"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Push-to-talk dictation for the Game Plan composer, built on the
// browser-native Web Speech API (SpeechRecognition). No audio ever leaves
// the browser through our own network stack and there is no transcription
// vendor or API key involved — Chrome/Edge route audio to the OS/Google
// recognizer and Safari routes it to the same on-device engine that powers
// keyboard dictation. CSP `connect-src` does not apply because the browser,
// not the page, makes that request.
//
// The hard part this hook exists to solve is DURATION. Every browser's
// SpeechRecognition ends the session on its own: Chrome cuts out after a
// stretch of silence (and sometimes just spontaneously), and iOS Safari
// ends after every single utterance regardless of `continuous`. Left alone
// that gives you a mic button that dies after one sentence. So the hook
// keeps a `wantOn` ref as the source of truth for "the user still has the
// mic held open" and restarts recognition from `onend` whenever that ref is
// still true. From the recruiter's side the session is unbounded — talk for
// twenty seconds or twenty minutes, it keeps listening until the button is
// clicked again.
//
// Restart bookkeeping:
//   - `start()` can throw InvalidStateError if the engine has not finished
//     tearing down. Swallowed and retried on the next tick.
//   - A restart storm (engine refusing to come back, e.g. the tab lost mic
//     access) is capped by CONSECUTIVE_RESTART_LIMIT so we surface an error
//     instead of spinning forever.
//   - The counter resets on `onaudiostart` (real audio flowing again), so a
//     genuinely long dictation never accumulates toward the cap.

const CONSECUTIVE_RESTART_LIMIT = 12;
const RESTART_DELAY_MS = 220;

export type VoiceDictationStatus =
  | "idle"
  | "starting"
  | "listening"
  | "error";

export type UseVoiceDictationOptions = {
  // Called with each finalized phrase (already trimmed, no leading space).
  // The consumer owns where the text lands and any length cap.
  onFinalText: (text: string) => void;
  // Called continuously with the in-flight, not-yet-finalized words so the
  // composer can show them greyed. Fires with "" when a phrase finalizes.
  onInterimText?: (text: string) => void;
  lang?: string;
};

export type UseVoiceDictation = {
  // False on browsers with no SpeechRecognition at all (Firefox today).
  // Consumers hide the mic button entirely rather than showing a dead one.
  supported: boolean;
  listening: boolean;
  status: VoiceDictationStatus;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
};

function getRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function useVoiceDictation({
  onFinalText,
  onInterimText,
  lang,
}: UseVoiceDictationOptions): UseVoiceDictation {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<VoiceDictationStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  // "The user wants the mic open." Drives the auto-restart loop and is the
  // only thing that distinguishes an intentional stop from the engine
  // ending the session by itself.
  const wantOnRef = useRef(false);
  const restartCountRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the one-time getUserMedia permission prime has already run.
  const primedRef = useRef(false);
  // Latest not-yet-final phrase. Held so an intentional stop() can commit
  // it instead of dropping it — clicking the mic mid-sentence should keep
  // the words already on screen, not erase them.
  const interimRef = useRef("");

  // Callbacks live in refs so the recognition instance's handlers never go
  // stale, and so re-created handlers don't force the hook to tear down and
  // rebuild recognition mid-sentence.
  const onFinalTextRef = useRef(onFinalText);
  const onInterimTextRef = useRef(onInterimText);
  useEffect(() => {
    onFinalTextRef.current = onFinalText;
    onInterimTextRef.current = onInterimText;
  }, [onFinalText, onInterimText]);

  useEffect(() => {
    setSupported(Boolean(getRecognitionCtor()));
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const teardown = useCallback(() => {
    clearRestartTimer();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    // Null the handlers before abort() so the pending onend can't kick the
    // restart loop back to life on the way out.
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.onstart = null;
    recognition.onaudiostart = null;
    try {
      recognition.abort();
    } catch {
      // Already dead. Nothing to do.
    }
  }, [clearRestartTimer]);

  const stop = useCallback(() => {
    wantOnRef.current = false;
    teardown();
    // Flush before clearing. teardown() abort()s the engine, which throws
    // away any phrase it had not finalized, so the pending words have to be
    // committed here or they vanish on the click that stops the mic.
    const pending = interimRef.current.trim();
    interimRef.current = "";
    onInterimTextRef.current?.("");
    if (pending) onFinalTextRef.current(pending);
    setStatus((prev) => (prev === "error" ? prev : "idle"));
  }, [teardown]);

  // Declared as a ref-held function because launch() and the onend handler
  // are mutually recursive — onend calls launch, launch installs onend.
  const launchRef = useRef<() => void>(() => {});

  const launch = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    // Drop any previous instance first. Chrome throws InvalidStateError if
    // two instances contend for the mic.
    teardown();
    if (!wantOnRef.current) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang =
      lang ??
      (typeof navigator !== "undefined" && navigator.language
        ? navigator.language
        : "en-US");

    recognition.onaudiostart = () => {
      // Audio is genuinely flowing, so this is a healthy session — forgive
      // the restarts that got us here and let a long dictation run forever.
      restartCountRef.current = 0;
      setStatus("listening");
      setError(null);
    };

    recognition.onresult = (event) => {
      let interim = "";
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) finalChunk += transcript;
        else interim += transcript;
      }
      const finalText = finalChunk.trim();
      if (finalText) {
        interimRef.current = "";
        onFinalTextRef.current(finalText);
        onInterimTextRef.current?.("");
      }
      // Only report interim when there's no final in the same event — a
      // final + interim pair would briefly double-render the same words.
      if (!finalText) {
        interimRef.current = interim.trim();
        onInterimTextRef.current?.(interimRef.current);
      }
    };

    recognition.onerror = (event) => {
      switch (event.error) {
        case "no-speech":
        case "audio-capture-timeout":
          // Silence, not a failure. onend follows and the loop restarts.
          return;
        case "aborted":
          // Either our own teardown or a benign engine reset. onend decides.
          return;
        case "not-allowed":
        case "service-not-allowed":
          wantOnRef.current = false;
          setError(
            "Microphone blocked. Allow mic access for this site in your browser settings, then try again.",
          );
          setStatus("error");
          teardown();
          interimRef.current = "";
          onInterimTextRef.current?.("");
          return;
        case "audio-capture":
          wantOnRef.current = false;
          setError("No microphone found.");
          setStatus("error");
          teardown();
          interimRef.current = "";
          onInterimTextRef.current?.("");
          return;
        case "network":
          // Recoverable — the restart loop retries and the cap catches a
          // genuinely offline device.
          return;
        default:
          return;
      }
    };

    recognition.onend = () => {
      if (!wantOnRef.current) {
        setStatus((prev) => (prev === "error" ? prev : "idle"));
        return;
      }
      restartCountRef.current += 1;
      if (restartCountRef.current > CONSECUTIVE_RESTART_LIMIT) {
        wantOnRef.current = false;
        setError("Dictation kept dropping. Check your mic and try again.");
        setStatus("error");
        interimRef.current = "";
        onInterimTextRef.current?.("");
        return;
      }
      clearRestartTimer();
      restartTimerRef.current = setTimeout(() => {
        if (wantOnRef.current) launchRef.current();
      }, RESTART_DELAY_MS);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // InvalidStateError from a not-yet-released engine. Retry once on a
      // delay; the restart cap bounds this if it never frees up.
      restartCountRef.current += 1;
      if (restartCountRef.current > CONSECUTIVE_RESTART_LIMIT) {
        wantOnRef.current = false;
        setError("Could not start dictation. Try again.");
        setStatus("error");
        return;
      }
      clearRestartTimer();
      restartTimerRef.current = setTimeout(() => {
        if (wantOnRef.current) launchRef.current();
      }, RESTART_DELAY_MS);
    }
  }, [clearRestartTimer, lang, teardown]);

  useEffect(() => {
    launchRef.current = launch;
  }, [launch]);

  const start = useCallback(() => {
    if (!getRecognitionCtor()) return;
    if (wantOnRef.current) return;
    wantOnRef.current = true;
    restartCountRef.current = 0;
    setError(null);
    setStatus("starting");

    // Prime the mic permission once via getUserMedia. On an installed iOS
    // PWA, SpeechRecognition's own permission prompt is unreliable, and the
    // restarts that keep a long dictation alive are not user gestures — so
    // we bank an explicit grant on the first click. The tracks are released
    // the moment they arrive; SpeechRecognition opens its own capture.
    //
    // Fire-and-forget, NOT awaited: awaiting would push recognition.start()
    // out of the click's user-gesture window, and Safari refuses to start
    // recognition outside one on first use. Both calls therefore happen in
    // this same synchronous tick, and any failure here is ignored — it just
    // means SpeechRecognition's own prompt (or its not-allowed error) is
    // what decides.
    if (!primedRef.current && navigator.mediaDevices?.getUserMedia) {
      primedRef.current = true;
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => stream.getTracks().forEach((track) => track.stop()))
        .catch(() => {});
    }

    launch();
  }, [launch]);

  const toggle = useCallback(() => {
    if (wantOnRef.current) stop();
    else start();
  }, [start, stop]);

  // Unmount / navigation must release the mic — an orphaned recognition
  // instance keeps the browser's recording indicator lit and, on Chrome,
  // keeps streaming audio after the Game Plan card is gone.
  useEffect(() => {
    return () => {
      wantOnRef.current = false;
      clearRestartTimer();
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (!recognition) return;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onstart = null;
      recognition.onaudiostart = null;
      try {
        recognition.abort();
      } catch {
        // Already released.
      }
    };
  }, [clearRestartTimer]);

  return {
    supported,
    listening: status === "starting" || status === "listening",
    status,
    error,
    start,
    stop,
    toggle,
  };
}
