"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface DictationButtonProps {
  /** Called with interim (isFinal=false) and final (isFinal=true) speech results. */
  onText: (text: string, isFinal: boolean) => void;
  /** BCP 47 language tag, e.g. "en-US", "fr-FR". Passed directly to SpeechRecognition. */
  lang?: string;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

/**
 * Types for the non-standard Web Speech API (SpeechRecognition), available
 * in Chromium-based browsers as `webkitSpeechRecognition` or unprefixed.
 * Not part of any TS lib — declared here manually.
 */
interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): BrowserSpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

/** Maps native error codes to user-facing messages — avoids exposing raw error strings. */
const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access denied. Please allow microphone access in your browser settings.",
  "no-speech": "No speech detected. Please try again.",
  "audio-capture": "No microphone found.",
  "network": "Network error. Please check your connection.",
  "aborted": "Listening stopped.",
  "service-not-allowed": "Speech recognition not available. Try using Chrome or Edge.",
  "bad-grammar": "Speech recognition failed. Try speaking more clearly.",
  "language-not-supported": "Speech recognition is not supported for this language.",
};

/**
 * DictationButton — browser speech-to-text toggle button.
 * Uses the Web Speech API (Chromium-only). Hidden entirely when unsupported.
 * Feeds interim and final text back through `onText` for realtime insertion.
 */
const DictationButton: React.FC<DictationButtonProps> = ({ onText, lang = "en-US" }) => {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  // Check for SpeechRecognition support
  useEffect(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognitionAPI);
  }, []);

  // Show error temporarily (auto-dismiss)
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Already stopped
      }
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const resultItem = event.results[i];
        if (!resultItem || !resultItem[0]) continue;
        const transcript = resultItem[0].transcript;
        if (resultItem.isFinal) {
          final += transcript + " ";
        } else {
          interim += transcript;
        }
      }

      if (final) {
        onText(final.trim(), true);
      }
      if (interim) {
        onText(interim.trim(), false);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const msg = ERROR_MESSAGES[event.error] || `Speech recognition error: ${event.error}`;
      setError(msg);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setError(null);
  }, [lang, onText]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Hidden when not supported
  if (!isSupported) return null;

  return (
    <div className="relative inline-flex items-center gap-2">
      <button
        type="button"
        onClick={toggleListening}
        title={isListening ? "Stop listening" : "Start dictation"}
        className={`shrink-0 p-1.5 rounded transition-colors
          ${isListening
            ? "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          }`}
      >
        {/* Microphone SVG icon */}
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>

      {isListening && (
        <span className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 animate-pulse">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          Listening...
        </span>
      )}

      {error && (
        <span className="absolute left-0 top-full mt-1 w-64 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-2 py-1 z-50">
          {error}
        </span>
      )}
    </div>
  );
};

export default DictationButton;
