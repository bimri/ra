// C2 · Speak: "You can also say 'let's do a Ray', 'show me my rings'."
// A held thought that is really a command goes where it asks, and isn't kept.

export type SpokenCommand = "ray" | "rings" | "chart" | "today";

const COMMANDS: [RegExp, SpokenCommand][] = [
  [/\b(let'?s|let us|can we|i want to|start)\s+(do\s+|have\s+|start\s+)?an?\s+ray\b/i, "ray"],
  [/\b(show|open|see)\s+(me\s+)?(my\s+)?rings\b/i, "rings"],
  [/\b(show|open|see)\s+(me\s+)?(my\s+)?chart\b/i, "chart"],
  [/\b(show|open|see)\s+(me\s+)?(my\s+)?today\b/i, "today"],
];

/** The command a short spoken line asks for, or null if it's a thought to keep. */
export function spokenCommand(text: string): SpokenCommand | null {
  const t = text.trim();
  // A command is short; a long thought that mentions rings is still a thought.
  if (!t || t.split(/\s+/).length > 8) return null;
  return COMMANDS.find(([re]) => re.test(t))?.[1] ?? null;
}
