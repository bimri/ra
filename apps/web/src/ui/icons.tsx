// Ra's icon set (U7): 24 × 24 grid, 1.5 stroke, round caps and joins, one
// signal-coloured piece per icon (the `ia` class). Muted at rest, signal when
// on. Paths copied from the App UI v2 canvas; change them there first.

const PATHS = {
  "today": "<path d=\"M3 17.5h18\"/><path d=\"M6.5 17.5a5.5 5.5 0 0 1 11 0\"/><path class=\"ia\" d=\"M9 17.5a3 3 0 0 1 6 0z\"/><path d=\"M12 6.5v2M6.3 9.2l1.3 1.1M17.7 9.2l-1.3 1.1M8.5 20.5h7\"/>",
  "chart": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path class=\"ia\" d=\"M12 6.2 13.3 10.7 17.8 12 13.3 13.3 12 17.8 10.7 13.3 6.2 12 10.7 10.7z\"/>",
  "rings": "<path d=\"M12.2 3.3c4.9.1 8.6 3.9 8.5 8.8-.1 4.9-4 8.7-8.9 8.6-4.8-.1-8.5-4-8.4-8.8.1-4.9 4-8.7 8.8-8.6z\"/><path d=\"M12.4 7.4c2.6 0 4.6 2.1 4.6 4.7s-2.1 4.7-4.7 4.7-4.6-2.1-4.6-4.7 2.1-4.7 4.7-4.7z\"/><circle class=\"ia\" cx=\"12.7\" cy=\"11.8\" r=\"1.7\"/>",
  "crews": "<circle cx=\"5.5\" cy=\"10.5\" r=\"2.1\"/><circle cx=\"18.5\" cy=\"10.5\" r=\"2.1\"/><circle class=\"ia\" cx=\"12\" cy=\"7.6\" r=\"2.5\"/><path d=\"M2.5 18.8c.5-2.3 1.6-3.6 3-3.6M21.5 18.8c-.5-2.3-1.6-3.6-3-3.6M7.4 19.5c.8-3.5 2.4-5.3 4.6-5.3s3.8 1.8 4.6 5.3\"/>",
  "ray": "<circle class=\"ia\" cx=\"12\" cy=\"9\" r=\"4.2\"/><path d=\"M3 14.5h18M6.5 17.5h11M9.5 20.5h5\"/>",
  "mic": "<rect x=\"9\" y=\"3.5\" width=\"6\" height=\"11\" rx=\"3\"/><path d=\"M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5\"/>",
  "star": "<path d=\"M12 2.5c.5 5.4 4.1 9 9.5 9.5-5.4.5-9 4.1-9.5 9.5-.5-5.4-4.1-9-9.5-9.5 5.4-.5 9-4.1 9.5-9.5z\"/><circle class=\"ia\" cx=\"12\" cy=\"12\" r=\"1.7\"/>",
  "horizon": "<path d=\"M3 17h18\"/><path d=\"M5 13.2c2.4-1.3 4.6-1.3 7 0s4.6 1.3 7 0\"/><circle class=\"ia\" cx=\"16.5\" cy=\"7.5\" r=\"2\"/>",
  "island": "<path d=\"M3 19c3-1.3 6-2 9-2s6 .7 9 2\"/><path d=\"M11.5 17V9.5\"/><path d=\"M11.5 9.5c-1.3-1.9-3.4-2.4-5.5-1.6M11.5 9.5c1.1-2 3.2-2.7 5.4-2.1M11.5 9.5c-.2-2.2.8-3.9 2.8-4.8\"/><circle class=\"ia\" cx=\"18.6\" cy=\"4.6\" r=\"1.5\"/>",
  "beacon": "<path d=\"M9.8 21h4.4l-.9-9.5h-2.6z\"/><path d=\"M8.5 11.5h7\"/><circle class=\"ia\" cx=\"12\" cy=\"8.3\" r=\"2.1\"/><path d=\"M5.6 6.2 3.7 5M18.4 6.2l1.9-1.2M5 9.6H2.8M19 9.6h2.2\"/>",
  "dial": "<path d=\"M3.5 16.5a8.5 8.5 0 0 1 17 0\"/><path d=\"m12 16.5 4.2-5.2\"/><circle class=\"ia\" cx=\"12\" cy=\"16.5\" r=\"1.7\"/><path d=\"M6.1 12.4l1 .7M12 8v1.2M17.9 12.4l-1 .7\"/>",
  "witness": "<path d=\"M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z\"/><circle class=\"ia\" cx=\"12\" cy=\"12\" r=\"2.7\"/>",
  "capture": "<path d=\"M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5\"/><circle class=\"ia\" cx=\"12\" cy=\"12\" r=\"3\"/>",
  "wave": "<path d=\"M4 10.5v3M7.5 7.5v9M11 4.5v15M14.5 8v8M18 10v4\"/><circle class=\"ia\" cx=\"21\" cy=\"12\" r=\"1.2\"/>",
  "ear": "<path d=\"M7 9.5a5 5 0 0 1 10 0c0 3.1-2.4 4.1-3 6.6-.4 2-1.6 3.4-3.5 3.4\"/><path d=\"M10 10a2 2 0 0 1 4 0\"/><circle class=\"ia\" cx=\"19.6\" cy=\"4.6\" r=\"1.4\"/>",
  "flag": "<path d=\"M6 21V4\"/><path class=\"ia\" d=\"M6.8 4.5h10.4l-2.6 4 2.6 4H6.8z\"/>",
  "lock": "<rect x=\"5\" y=\"10.5\" width=\"14\" height=\"10\" rx=\"2.5\"/><path d=\"M8 10.5V8a4 4 0 0 1 8 0v2.5\"/><circle class=\"ia\" cx=\"12\" cy=\"15.5\" r=\"1.5\"/>",
  "moon": "<path d=\"M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z\"/><circle class=\"ia\" cx=\"17.6\" cy=\"6\" r=\"1.2\"/>",
  "play": "<path d=\"M8 5.5v13l10-6.5z\" fill=\"currentColor\" stroke=\"none\"/>",
  "pause": "<path d=\"M9 6v12M15 6v12\"/>",
  "check": "<path d=\"m5 12.5 4.5 4.5L19 7.5\"/>",
  "arrow": "<path d=\"M5 12h14M13 6l6 6-6 6\"/>",
  "settings": "<path d=\"M4 7h10M18 7h2M4 17h4M12 17h8\"/><circle cx=\"16\" cy=\"7\" r=\"2\"/><circle cx=\"10\" cy=\"17\" r=\"2\"/>",
  "keyboard": "<rect x=\"3\" y=\"6.5\" width=\"18\" height=\"11\" rx=\"2\"/><path d=\"M7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8\"/>",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, strokeWidth = 1.5 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      // Static paths from the canvas, not user content.
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
