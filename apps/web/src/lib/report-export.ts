// The server builds the workbook and returns it as a File; a detached anchor saves it
// under the name the server chose. The object URL is released after the download starts.
export const saveXlsx = {
  onSuccess: (file: File) => {
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
