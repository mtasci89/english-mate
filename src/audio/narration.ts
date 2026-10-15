/**
 * Plays one page of a narrated book.
 *
 * A StoryWeaver book is a single MP3 with the timing of every word, so a page
 * is a slice of it: seek to the first word, play, stop after the last. One
 * element is reused across pages so the file downloads once and seeking stays
 * instant.
 */

let element: HTMLAudioElement | null = null;
let stopCurrent: (() => void) | null = null;

function audioFor(src: string) {
  if (!element) {
    element = new Audio();
    element.preload = "auto";
  }
  if (element.src !== src) element.src = src;
  return element;
}

/** Starts the download ahead of the first page, so it does not stall. */
export function preloadNarration(src: string) {
  audioFor(src).load();
}

function ready(audio: HTMLAudioElement) {
  if (audio.readyState >= 1) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("error", onError);
      resolve(ok);
    };
    const onLoaded = () => done(true);
    const onError = () => done(false);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("error", onError);
  });
}

/**
 * Resolves `true` once the slice has played, `false` if the file could not be
 * played at all — the caller then falls back to a synthetic voice.
 */
export async function playSlice(src: string, start: number, end: number, rate: number) {
  stopNarration();
  const audio = audioFor(src);
  if (!(await ready(audio))) return false;

  return new Promise<boolean>((resolve) => {
    let timer = 0;
    const finish = (ok: boolean) => {
      window.clearInterval(timer);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      stopCurrent = null;
      resolve(ok);
    };
    const onEnded = () => finish(true);
    const onError = () => finish(false);
    stopCurrent = () => finish(true);

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.currentTime = start;
    audio.playbackRate = rate;
    audio.preservesPitch = true;

    // `timeupdate` fires only about four times a second, late enough to bleed
    // the next page's first word in; a short poll stops on the boundary.
    timer = window.setInterval(() => {
      if (audio.currentTime >= end) finish(true);
    }, 40);

    audio.play().catch(() => finish(false));
  });
}

export function stopNarration() {
  stopCurrent?.();
}
