/** Build the canonical Home URL without stale workspace deep links. */
export function getHomeLocation(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("section");
  url.searchParams.delete("workspace");

  // Electron uses HashRouter, so deep-link parameters can live inside the
  // fragment (for example #/?section=decks). Clear those as well; otherwise
  // the stale hash immediately sends Home back to the previous workspace.
  if (url.hash.startsWith("#/")) {
    const hashUrl = new URL(url.hash.slice(1), "http://electron.local");
    hashUrl.searchParams.delete("section");
    hashUrl.searchParams.delete("workspace");
    url.hash = `${hashUrl.pathname}${hashUrl.search}${hashUrl.hash}`;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
