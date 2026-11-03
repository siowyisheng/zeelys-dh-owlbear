/**
 * Resolve an extension-owned document or asset beside the currently loaded
 * extension page. Using the document directory preserves hosting subpaths
 * such as GitHub Pages project sites.
 */
export function extensionUrl(path: string): string {
  const extensionDirectory = new URL("./", window.location.href);
  return new URL(path.replace(/^\/+/, ""), extensionDirectory).toString();
}
