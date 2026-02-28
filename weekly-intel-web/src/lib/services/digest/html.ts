import type { DigestContent } from "./generator";

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderHtmlEmail(content: DigestContent): string {
  // Executive summary links
  let execSummaryHtml = "";
  for (let i = 0; i < content.executiveSummary.length; i++) {
    execSummaryHtml += `<li><a href="#theme-${i + 1}" style="color: #0066cc; text-decoration: none;">${escape(content.executiveSummary[i])}</a></li>\n`;
  }

  // Themes
  let themesHtml = "";
  for (let i = 0; i < content.themes.length; i++) {
    const theme = content.themes[i];
    let noveltyClass = "tag-new";
    let noveltyText = "New";
    if (theme.isFollowup) {
      noveltyClass = "tag-ongoing";
      noveltyText = "Follow-up";
    } else if (!theme.isNovel) {
      noveltyClass = "tag-ongoing";
      noveltyText = "Ongoing";
    }

    const sourcesText = theme.sources.map(escape).join(", ");

    themesHtml += `
    <section id="theme-${i + 1}" class="section">
      <span class="${noveltyClass}">${noveltyText}</span>
      <h3 style="margin-top: 8px; margin-bottom: 8px; color: #333;">${escape(theme.name)}</h3>
      <p style="margin: 0 0 12px 0; color: #444;">${escape(theme.synthesizedSummary)}</p>
      <p class="sources">Sources: ${sourcesText}</p>
    </section>
`;
  }

  // Hot takes
  let hotTakesHtml = "";
  if (content.hotTakes.length > 0) {
    let takesInner = "";
    for (const take of content.hotTakes) {
      takesInner += `
      <div class="hot-take">
        <p style="margin: 0;"><strong>${escape(take.author)}</strong> (${escape(take.source)}): ${escape(take.take)}</p>
        <p style="margin: 4px 0 0 0; font-size: 14px; color: #666; font-style: italic;">${escape(take.assessment)}</p>
      </div>
`;
    }
    hotTakesHtml = `<section class="section">
      <h2 style="margin-top: 0; color: #333;">Hot Takes</h2>
${takesInner}
    </section>`;
  }

  // Signals
  let signalsHtml = "";
  if (content.signalsToWatch.length > 0) {
    let signalItems = "";
    for (const signal of content.signalsToWatch) {
      signalItems += `        <li style="margin-bottom: 8px;">${escape(signal)}</li>\n`;
    }
    signalsHtml = `<section class="section">
      <h2 style="margin-top: 0; color: #333;">Signals to Watch</h2>
      <ul style="margin: 0; padding-left: 20px;">
${signalItems}      </ul>
    </section>`;
  }

  // Source index
  let sourceRows = "";
  for (const source of content.sourceIndex) {
    sourceRows += `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${escape(source.name)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${source.itemCount}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${escape(source.sourceType)}</td>
        </tr>`;
  }

  const timestamp = content.generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>Weekly Intel - Week of ${escape(content.dateRange)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background: #fff; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #eee; margin-bottom: 20px; }
    .header h1 { margin: 0 0 8px 0; font-size: 28px; color: #333; }
    .subtitle { font-size: 14px; color: #666; margin: 0; }
    .section { background: #f8f9fa; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .executive-summary { background: #e8f4fd; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .executive-summary h2 { margin-top: 0; color: #333; }
    .executive-summary ul { margin: 0; padding-left: 20px; }
    .executive-summary li { margin-bottom: 8px; }
    .tag-new { display: inline-block; background: #d4edda; color: #155724; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .tag-ongoing { display: inline-block; background: #fff3cd; color: #856404; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .hot-take { border-left: 4px solid #dc3545; padding-left: 12px; margin: 12px 0; }
    .sources { font-size: 14px; color: #666; margin: 0; }
    .source-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .source-table th { background: #f1f3f4; padding: 10px 8px; text-align: left; font-size: 14px; border-bottom: 2px solid #ddd; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; }
    .footer p { font-size: 14px; color: #888; margin: 8px 0; }
    .footer a { color: #0066cc; text-decoration: none; }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a; color: #e0e0e0; }
      .header h1 { color: #fff; }
      .subtitle { color: #aaa; }
      .section { background: #2d2d2d; }
      .section h3 { color: #fff !important; }
      .section p { color: #ccc !important; }
      .executive-summary { background: #1e3a5f; }
      .executive-summary h2 { color: #fff; }
      .sources { color: #aaa; }
      .tag-new { background: #1e4620; color: #a3d9a5; }
      .tag-ongoing { background: #5a4b00; color: #ffd93d; }
      .source-table th { background: #333; color: #ddd; }
      .source-table td { color: #ccc; border-bottom-color: #444 !important; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>Weekly Intel</h1>
      <p class="subtitle">Week of ${escape(content.dateRange)} | ${content.sourcesCount} sources | ${content.itemsCount} items</p>
    </header>

    <section class="executive-summary">
      <h2>This Week in 30 Seconds</h2>
      <ul>
${execSummaryHtml}      </ul>
    </section>

    <h2 style="color: #333; margin-top: 30px;">Key Themes</h2>
${themesHtml}

    ${hotTakesHtml}

    ${signalsHtml}

    <section class="section">
      <h2 style="margin-top: 0; color: #333;">Source Index</h2>
      <table class="source-table">
        <thead>
          <tr>
            <th>Source</th>
            <th style="text-align: center;">Items</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
${sourceRows}
        </tbody>
      </table>
    </section>

    <footer class="footer">
      <p>Generated ${timestamp} by Weekly Intel</p>
    </footer>
  </div>
</body>
</html>`;
}

export function renderPlainText(content: DigestContent): string {
  const lines: string[] = [];

  lines.push("WEEKLY INTEL DIGEST");
  lines.push(`Week of ${content.dateRange}`);
  lines.push(`${content.sourcesCount} sources | ${content.itemsCount} items`);
  lines.push("");
  lines.push("=".repeat(50));
  lines.push("");

  lines.push("THIS WEEK IN 30 SECONDS");
  lines.push("-".repeat(30));
  for (const point of content.executiveSummary) {
    lines.push(`* ${point}`);
  }
  lines.push("");

  lines.push("KEY THEMES");
  lines.push("-".repeat(30));
  for (let i = 0; i < content.themes.length; i++) {
    const theme = content.themes[i];
    let novelty = "[NEW]";
    if (theme.isFollowup) novelty = "[FOLLOW-UP]";
    else if (!theme.isNovel) novelty = "[ONGOING]";
    lines.push(`${i + 1}. ${novelty} ${theme.name}`);
    lines.push(`   ${theme.synthesizedSummary}`);
    lines.push(`   Sources: ${theme.sources.join(", ")}`);
    lines.push("");
  }

  if (content.hotTakes.length > 0) {
    lines.push("HOT TAKES");
    lines.push("-".repeat(30));
    for (const take of content.hotTakes) {
      lines.push(`* ${take.author} (${take.source}): ${take.take}`);
      if (take.assessment) lines.push(`  Assessment: ${take.assessment}`);
    }
    lines.push("");
  }

  if (content.signalsToWatch.length > 0) {
    lines.push("SIGNALS TO WATCH");
    lines.push("-".repeat(30));
    for (const signal of content.signalsToWatch) {
      lines.push(`* ${signal}`);
    }
    lines.push("");
  }

  lines.push("=".repeat(50));
  const timestamp = content.generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  lines.push(`Generated ${timestamp} by Weekly Intel`);

  return lines.join("\n");
}
