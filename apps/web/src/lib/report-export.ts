type ReportSheet = {
  name: string;
  columns: Array<{ header: string; key: string; width?: number }>;
  rows: Array<Record<string, string | number>>;
};

export async function downloadXlsx(filename: string, sheets: ReportSheet[]): Promise<void> {
  // ExcelJS is export-only and large; load it on demand to keep it out of the main application chunk.
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.columns = sheet.columns.map((column) => ({
      header: column.header,
      key: column.key,
      width: column.width ?? Math.max(column.header.length + 2, 12),
    }));
    worksheet.addRows(sheet.rows);
    worksheet.getRow(1).font = { bold: true };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
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
