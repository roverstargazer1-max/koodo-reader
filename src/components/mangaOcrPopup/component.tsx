import React from "react";
import "./index.css";

export interface MangaOcrPopupProps {
  status: "idle" | "loading" | "success" | "translating" | "error";
  sourceText: string;
  translatedText: string;
  error: string;
  rect: { left: number; top: number; width: number; height: number } | null;
  onClose: () => void;
  onRetry: () => void;
  onCopy: () => void;
  onTranslate: () => void;
}

const MangaOcrPopup = ({
  status,
  sourceText,
  translatedText,
  error,
  rect,
  onClose,
  onRetry,
  onCopy,
  onTranslate,
}: MangaOcrPopupProps) => {
  if (status === "idle") return null;
  const left = rect
    ? Math.max(12, Math.min(rect.left, window.innerWidth - 332))
    : Math.max(12, window.innerWidth / 2 - 160);
  const top = rect
    ? Math.min(rect.top + rect.height + 10, window.innerHeight - 190)
    : Math.max(12, window.innerHeight / 2 - 95);
  return (
    <div className="manga-ocr-popup" style={{ left, top }} role="dialog">
      <div className="manga-ocr-popup-header">
        <strong>Manga OCR</strong>
        <button type="button" className="manga-ocr-icon-button" onClick={onClose} aria-label="Close">
          <span className="icon-close" />
        </button>
      </div>
      {status === "loading" ? (
        <div className="manga-ocr-popup-loading" role="status">
          <span className="manga-ocr-spinner" />
          <span>Reading page text...</span>
        </div>
      ) : status === "error" ? (
        <div className="manga-ocr-popup-error">
          <div>{error || "Manga OCR request failed"}</div>
          <button type="button" className="manga-ocr-action" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="manga-ocr-source-text">{sourceText || "No text detected"}</div>
          {status === "translating" ? (
            <div className="manga-ocr-popup-loading" role="status">
              <span className="manga-ocr-spinner" />
              <span>Translating...</span>
            </div>
          ) : (
            <>
              {translatedText ? (
                <div className="manga-ocr-translation-text">{translatedText}</div>
              ) : null}
              {error ? <div className="manga-ocr-inline-error">{error}</div> : null}
              <div className="manga-ocr-popup-actions">
                <button type="button" className="manga-ocr-action" onClick={onCopy} disabled={!sourceText}>
                  <span className="icon-copy" /> {translatedText ? "Copy translation" : "Copy"}
                </button>
                <button type="button" className="manga-ocr-action" onClick={onTranslate} disabled={!sourceText}>
                  <span className="icon-translate" /> {translatedText ? "Translate again" : "Translate"}
                </button>
                <button type="button" className="manga-ocr-action" onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default MangaOcrPopup;
