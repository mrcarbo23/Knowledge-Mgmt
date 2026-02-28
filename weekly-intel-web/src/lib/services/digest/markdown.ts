import type { DigestContent } from "./generator";

export function renderMarkdown(content: DigestContent): string {
  const lines: string[] = [];

  // Header
  lines.push("# Weekly Intel Digest");
  lines.push(
    `**Week of ${content.dateRange}** | ` +
      `${content.sourcesCount} sources processed | ` +
      `${content.itemsCount} items analyzed`
  );
  lines.push("");

  // Executive Summary
  lines.push("## Executive Summary");
  lines.push("");
  for (const point of content.executiveSummary) {
    lines.push(`- ${point}`);
  }
  lines.push("");

  // Key Themes
  lines.push("## Key Themes This Week");
  lines.push("");

  for (let i = 0; i < content.themes.length; i++) {
    const theme = content.themes[i];

    lines.push(`### ${i + 1}. ${theme.name}`);
    lines.push("");
    lines.push(theme.synthesizedSummary);
    lines.push("");

    const sourcesStr = theme.sources.join(", ");
    lines.push(`**Sources:** ${sourcesStr}`);

    let indicator = "New";
    if (theme.isFollowup) indicator = "Follow-up";
    else if (!theme.isNovel) indicator = "Ongoing story";
    lines.push(`**Novelty:** ${indicator}`);
    lines.push("");
  }

  // Hot Takes
  if (content.hotTakes.length > 0) {
    lines.push("## Hot Takes & Contrarian Views");
    lines.push("");
    lines.push("| Take | Source | Assessment |");
    lines.push("|------|--------|------------|");

    for (const take of content.hotTakes) {
      const takeText = take.take.replace(/\|/g, "\\|");
      const sourceText = `${take.author} (${take.source})`.replace(
        /\|/g,
        "\\|"
      );
      const assessmentText = take.assessment.replace(/\|/g, "\\|");
      lines.push(`| ${takeText} | ${sourceText} | ${assessmentText} |`);
    }
    lines.push("");
  }

  // Signals to Watch
  if (content.signalsToWatch.length > 0) {
    lines.push("## Signals to Watch");
    lines.push("");
    for (const signal of content.signalsToWatch) {
      lines.push(`- ${signal}`);
    }
    lines.push("");
  }

  // Source Index
  if (content.sourceIndex.length > 0) {
    lines.push("## Source Index");
    lines.push("");
    lines.push("| Source | Items | Type |");
    lines.push("|--------|-------|------|");
    for (const source of content.sourceIndex) {
      lines.push(`| ${source.name} | ${source.itemCount} | ${source.sourceType} |`);
    }
    lines.push("");
  }

  // Footer
  lines.push("---");
  const timestamp = content.generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  lines.push(`*Generated ${timestamp} by Weekly Intel*`);

  return lines.join("\n");
}
