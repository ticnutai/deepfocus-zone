import { useEffect, useState } from "react";
import { MonitorDown } from "lucide-react";

const RELEASE_API = "https://api.github.com/repos/ticnutai/deepfocus-zone/releases/latest";
const RELEASE_PAGE = "https://github.com/ticnutai/deepfocus-zone/releases/latest";

type ReleaseAsset = { name: string; browser_download_url: string };
type LatestRelease = { tag_name?: string; assets?: ReleaseAsset[] };

export function DesktopAppDownloadButton() {
  const isElectron = Boolean(window.desktop?.isElectron);
  const [downloadUrl, setDownloadUrl] = useState(RELEASE_PAGE);
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (isElectron) return;
    let active = true;
    void fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } })
      .then((response) => response.ok ? response.json() as Promise<LatestRelease> : Promise.reject(new Error("release unavailable")))
      .then((release) => {
        if (!active) return;
        const installer = release.assets?.find((asset) => asset.name.toLowerCase().endsWith(".exe") && !asset.name.toLowerCase().endsWith(".blockmap"));
        if (installer) setDownloadUrl(installer.browser_download_url);
        setVersion((release.tag_name ?? "").replace(/^v/, ""));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [isElectron]);

  if (isElectron) return null;

  const label = version ? `הורד את אפליקציית למען למחשב — גרסה ${version}` : "הורד את אפליקציית למען למחשב";
  return (
    <a
      href={downloadUrl}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-full border border-gold/70 bg-card text-navy transition-colors hover:bg-secondary"
    >
      <MonitorDown className="h-4 w-4" />
    </a>
  );
}
