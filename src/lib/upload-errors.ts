// Plain-language reasons for a failed upload to Supabase Storage.
export function uploadErrorText(error: { message?: string; statusCode?: string | number } | null | undefined): string {
  const msg = (error?.message ?? "").toLowerCase();
  const code = String(error?.statusCode ?? "");
  if (code === "413" || msg.includes("maximum allowed size") || msg.includes("too large")) {
    return "the file is bigger than the storage account allows";
  }
  if (msg.includes("quota") || msg.includes("exceed") || msg.includes("limit") || code === "402") {
    return "the storage account is full or over its plan limit";
  }
  if (msg.includes("mime") || msg.includes("not supported") || code === "415") {
    return "that file type isn't accepted";
  }
  if (code === "403" || msg.includes("row-level security") || msg.includes("unauthorized")) {
    return "your role can't add files here";
  }
  if (msg.includes("fetch") || msg.includes("network")) {
    return "the connection dropped";
  }
  return error?.message ? `storage said: ${error.message}` : "an unknown problem";
}
