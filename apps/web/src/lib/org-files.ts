import { orpc } from "@/lib/orpc";

// `mimeType` overrides `file.type` for browsers that report an empty type.
export async function uploadOrgFile(
  orgSlug: string,
  file: File,
  mimeType?: string,
): Promise<string> {
  const contentType = mimeType ?? (file.type || undefined);
  const { key, uploadUrl } = await orpc.file.createUpload.call({
    orgSlug,
    name: file.name,
    mimeType: contentType,
    size: file.size,
  });
  const response = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Storage rejected the upload (${response.status})`);
  }
  await orpc.file.finalizeUpload.call({ orgSlug, key });
  return key;
}

export async function openOrgFile(orgSlug: string, key: string): Promise<void> {
  // Open synchronously while the click still owns a browser user gesture;
  // waiting for the presigned URL first makes popup blockers discard the tab.
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;

  try {
    const { url } = await orpc.file.getReadUrl.call({ orgSlug, key });
    if (popup) {
      popup.location.href = url;
    } else {
      window.location.assign(url);
    }
  } catch (error) {
    popup?.close();
    throw error;
  }
}

export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
