export function copyText(value: string): Promise<boolean> {
  try {
    const write = navigator.clipboard?.writeText(value);
    if (write)
      return write.then(
        () => true,
        () => copyFallback(value),
      );
  } catch {
    // Clipboard permission can fail even on a secure origin.
  }
  return Promise.resolve(copyFallback(value));
}

function copyFallback(value: string): boolean {
  let textarea: HTMLTextAreaElement | undefined;
  try {
    textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea?.remove();
  }
}
