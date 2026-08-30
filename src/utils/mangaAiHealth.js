const validateMangaAiHealth = (payload) => {
  if (!payload || payload.contractVersion !== "1") {
    return {
      ok: false,
      errorCode: "sidecar_contract_mismatch",
      error: "Manga AI sidecar does not support Contract v1",
    };
  }
  if (
    !Array.isArray(payload.capabilities) ||
    !payload.capabilities.includes("ocrRegion")
  ) {
    return {
      ok: false,
      errorCode: "sidecar_capability_missing",
      error: "Manga AI sidecar does not provide Region OCR",
    };
  }
  return { ok: true };
};

module.exports = { validateMangaAiHealth };
