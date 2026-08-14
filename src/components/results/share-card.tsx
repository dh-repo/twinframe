import { useState } from "react";
import { Download, Link2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  composeShareImage,
  copyShareText,
  downloadBlob,
  shareOrDownload,
} from "@/lib/ux/share-image";
import { shareText } from "@/lib/ux/honesty";

export interface ShareCardProps {
  youUrl: string | null;
  celebrityName: string;
  celebrityPhotoUrl?: string | null;
  celebrityPhoto192Url?: string | null;
  matchPercent: number;
}

export function ShareCard({
  youUrl,
  celebrityName,
  celebrityPhotoUrl,
  celebrityPhoto192Url,
  matchPercent,
}: ShareCardProps) {
  const [busy, setBusy] = useState<"share" | "download" | "copy" | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const photo = celebrityPhotoUrl || celebrityPhoto192Url || null;
  const text = shareText(celebrityName, matchPercent);
  const slug = celebrityName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "match";
  const filename = `twinframe-${slug}.png`;

  const compose = () =>
    composeShareImage({
      youUrl,
      celebrityName,
      celebrityPhotoUrl: photo,
      matchPercent,
    });

  const onShare = async () => {
    setBusy("share");
    setStatus(null);
    try {
      const blob = await compose();
      const result = await shareOrDownload({
        blob,
        filename,
        title: "Twinframe",
        text,
      });
      setStatus(result === "shared" ? "Shared." : "Image saved.");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus("Couldn't share — try Download instead.");
    } finally {
      setBusy(null);
    }
  };

  const onDownload = async () => {
    setBusy("download");
    setStatus(null);
    try {
      const blob = await compose();
      downloadBlob(blob, filename);
      setStatus("Image saved.");
    } catch {
      setStatus("Couldn't build the image. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const onCopy = async () => {
    setBusy("copy");
    setStatus(null);
    const ok = await copyShareText(text);
    setStatus(ok ? "Copied to clipboard." : "Copy failed — select and copy manually.");
    setBusy(null);
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Button
          type="button"
          variant="primary"
          size="md"
          className="col-span-2 sm:col-span-1"
          disabled={busy !== null}
          onClick={() => void onShare()}
        >
          <Share2 className="h-4 w-4" />
          {busy === "share" ? "Preparing…" : "Share"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          disabled={busy !== null}
          onClick={() => void onDownload()}
        >
          <Download className="h-4 w-4" />
          {busy === "download" ? "Saving…" : "Download"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="md"
          disabled={busy !== null}
          onClick={() => void onCopy()}
        >
          <Link2 className="h-4 w-4" />
          {busy === "copy" ? "Copying…" : "Copy text"}
        </Button>
      </div>
      {status && (
        <p className="text-center text-[11px] text-fg-muted" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
