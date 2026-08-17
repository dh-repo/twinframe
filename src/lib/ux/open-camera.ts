export type CameraFacing = "user" | "environment";

export function cameraNeedsHttps(): boolean {
  if (typeof window === "undefined") return false;
  return !window.isSecureContext && window.location.hostname !== "localhost";
}

export async function openCameraStream(facing: CameraFacing): Promise<MediaStream> {
  if (cameraNeedsHttps()) {
    throw new Error("https");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("unsupported");
  }
  const attempts: MediaStreamConstraints[] = [
    { audio: false, video: { facingMode: { ideal: facing } } },
    { audio: false, video: { facingMode: facing } },
    { audio: false, video: true },
  ];
  let last: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("Could not open the camera.");
}

export function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  const msg = err instanceof Error ? err.message : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission was denied. Use your phone’s camera or pick a photo from your library.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found. Pick a photo from your library instead.";
  }
  if (msg === "https") {
    return "Camera needs a secure (https) connection.";
  }
  if (msg === "unsupported") {
    return "This browser can’t open a live camera. Use your phone’s camera or pick a photo.";
  }
  return "Could not open the live camera. Use your phone’s camera, or pick a photo from your library.";
}

export function waitForVideoFrame(video: HTMLVideoElement, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Camera frame timed out."));
    }, timeoutMs);
    const onReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("loadeddata", onReady);
    };
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("loadeddata", onReady);
  });
}
