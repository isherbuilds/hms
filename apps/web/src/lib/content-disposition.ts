function encode5987(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** A fixed ASCII fallback plus RFC 5987 keeps arbitrary stored names header-safe. */
export function pdfContentDisposition(fileName: string, download: boolean): string {
  const disposition = download ? "attachment" : "inline";

  const safeFileName = Array.from(fileName, (character) => {
    const codePoint = character.codePointAt(0)!;

    return codePoint <= 31 || codePoint === 127 ? "_" : character;
  }).join("");

  return `${disposition}; filename="billing-document.pdf"; filename*=UTF-8''${encode5987(safeFileName)}`;
}
