import { toast } from "sonner";

type ReportSheet = {
  name: string;
  columns: Array<{ header: string; key: string; width?: number }>;
  rows: Array<Record<string, string | number>>;
};

// hucre keys header styles `"row,col"`; a column's own `style` would bold the
// whole column, not row 1.
const BOLD_HEADER = { style: { font: { bold: true } } };

// Every caller fires this from a click and does not await it, so failures are
// reported here rather than as an unhandled rejection.
export async function downloadXlsx(filename: string, sheets: ReportSheet[]): Promise<void> {
  let buffer: Uint8Array;
  try {
    // Export-only, so load it on demand. The `/xlsx` subpath is the narrowest entry
    // hucre exports; today it buys a readable chunk name rather than a size win.
    const { writeXlsx } = await import("hucre/xlsx");
    buffer = await writeXlsx({
      sheets: sheets.map((sheet) => ({
        name: sheet.name,
        columns: sheet.columns.map((column) => ({
          header: column.header,
          key: column.key,
          width: column.width ?? Math.max(column.header.length + 2, 12),
        })),
        data: sheet.rows,
        cells: new Map(sheet.columns.map((_, index) => [`0,${index}`, BOLD_HEADER])),
      })),
    });
  } catch (error) {
    console.error("xlsx export failed", error);
    toast.error("Could not build the spreadsheet");
    return;
  }

  // `WriteOutput` is `Uint8Array<ArrayBufferLike>`, which `BlobPart` rejects
  // because it also admits `SharedArrayBuffer`. hucre allocates a plain one.
  const blob = new Blob([buffer as Uint8Array<ArrayBuffer>], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // The click only queues the download, so revoking in the same task cancels it
  // in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
