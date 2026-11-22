import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const sourcePath = path.join(root, 'docs/guides/ai-system-engineering-guide.md');
const htmlPath = path.join(root, 'docs/guides/ai-system-engineering-guide.html');
const pdfPath = path.join(root, 'docs/guides/nexter-ai-system-engineering.pdf');

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function inline(value) {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return text;
}

function convertTable(lines) {
  const rows = lines
    .filter((line) => !/^\s*\|?\s*:?-{3,}/.test(line))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim()),
    );
  if (rows.length === 0) return '';
  const [header, ...body] = rows;
  const head = `<thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`;
  const rowsHtml = body
    .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<table>${head}<tbody>${rowsHtml}</tbody></table>`;
}

function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    if (trimmed.startsWith('<')) {
      const block = [];
      while (index < lines.length && (lines[index] ?? '').trim() !== '') {
        block.push(lines[index]);
        index += 1;
      }
      out.push(block.join('\n'));
      continue;
    }
    if (trimmed.startsWith('```')) {
      const code = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (trimmed.startsWith('|')) {
      const table = [];
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
        table.push(lines[index]);
        index += 1;
      }
      out.push(convertTable(table));
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*]\s+/, ''));
        index += 1;
      }
      out.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*\d+\.\s+/, ''));
        index += 1;
      }
      out.push(`<ol>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`);
      continue;
    }
    if (trimmed.startsWith('> ')) {
      const quote = [];
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('> ')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
        index += 1;
      }
      out.push(`<blockquote>${quote.map((item) => inline(item)).join(' ')}</blockquote>`);
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? '';
      const nextTrimmed = next.trim();
      if (
        !nextTrimmed ||
        nextTrimmed.startsWith('<') ||
        nextTrimmed.startsWith('```') ||
        nextTrimmed.startsWith('|') ||
        /^#{1,4}\s/.test(nextTrimmed) ||
        /^[-*]\s+/.test(nextTrimmed) ||
        /^\d+\.\s+/.test(nextTrimmed) ||
        nextTrimmed.startsWith('> ')
      ) {
        break;
      }
      paragraph.push(nextTrimmed);
      index += 1;
    }
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return out.join('\n');
}

const markdown = fs.readFileSync(sourcePath, 'utf8');
const body = markdownToHtml(markdown);
const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<title>Nexter AI — инженерное руководство</title>
<style>
  :root { color-scheme: light; }
  @page { size: A4; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", "Arial", sans-serif;
    color: #1f2937;
    font-size: 11pt;
    line-height: 1.55;
  }
  h1 {
    font-size: 30pt;
    line-height: 1.15;
    margin: 70mm 0 6mm;
    color: #064e3b;
    letter-spacing: -0.02em;
  }
  h2 {
    page-break-before: always;
    font-size: 19pt;
    color: #064e3b;
    margin: 0 0 5mm;
    padding-bottom: 2mm;
    border-bottom: 1.5pt solid #a7f3d0;
  }
  h3 {
    font-size: 14pt;
    color: #065f46;
    margin: 6mm 0 2mm;
    page-break-after: avoid;
  }
  h4 { font-size: 12pt; color: #065f46; margin: 4mm 0 1.5mm; }
  p { margin: 0 0 3mm; text-align: justify; }
  ul, ol { margin: 0 0 3mm 0; padding-left: 7mm; }
  li { margin: 0 0 1.4mm; }
  strong { color: #111827; }
  code {
    font-family: "Cascadia Mono", "Consolas", monospace;
    font-size: 9.5pt;
    background: #f1f5f9;
    padding: 0.4mm 1.2mm;
    border-radius: 1.5mm;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 2mm 0 5mm;
    font-size: 9.7pt;
    page-break-inside: avoid;
  }
  th, td {
    border: 0.6pt solid #cbd5e1;
    padding: 1.6mm 2mm;
    text-align: left;
    vertical-align: top;
  }
  th { background: #ecfdf5; color: #064e3b; }
  tr:nth-child(even) td { background: #f8fafc; }
  figure {
    margin: 4mm 0 6mm;
    padding: 3mm;
    border: 0.6pt solid #d1fae5;
    border-radius: 2mm;
    background: #fbfefc;
    page-break-inside: avoid;
  }
  figure svg { width: 100%; height: auto; display: block; }
  figcaption {
    margin-top: 2mm;
    font-size: 9pt;
    color: #475569;
    text-align: center;
  }
  .callout {
    margin: 4mm 0;
    padding: 3mm 4mm;
    border-left: 3pt solid #10b981;
    background: #ecfdf5;
    border-radius: 1.5mm;
    font-size: 10.2pt;
  }
  .page-break { page-break-after: always; }
  a { color: #047857; text-decoration: none; }
  blockquote {
    margin: 3mm 0;
    padding-left: 4mm;
    border-left: 2pt solid #94a3b8;
    color: #475569;
  }
  pre {
    background: #0f172a;
    color: #e2e8f0;
    padding: 3mm;
    border-radius: 2mm;
    font-size: 9pt;
    overflow-wrap: anywhere;
  }
  hr { border: none; border-top: 0.6pt solid #cbd5e1; margin: 5mm 0; }
</style>
</head>
<body>
${body}
</body>
</html>`;

fs.writeFileSync(htmlPath, html, 'utf8');

const requireFromE2e = createRequire(path.join(root, 'apps/e2e/package.json'));
let chromium;
try {
  ({ chromium } = requireFromE2e('playwright'));
} catch {
  const pnpmStore = path.join(root, 'node_modules/.pnpm');
  const packageDir = fs.existsSync(pnpmStore)
    ? fs.readdirSync(pnpmStore).find((name) => name.startsWith('playwright@'))
    : undefined;
  if (!packageDir) {
    throw new Error(
      'playwright is required to build the PDF. Run: pnpm --filter @nexter/e2e exec playwright install chromium',
    );
  }
  ({ chromium } = createRequire(import.meta.url)(
    path.join(pnpmStore, packageDir, 'node_modules/playwright'),
  ));
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate:
      '<div style="width:100%;font-size:7px;color:#94a3b8;padding:0 16mm;text-align:right;">Nexter AI — инженерное руководство</div>',
    footerTemplate:
      '<div style="width:100%;font-size:7px;color:#94a3b8;padding:0 16mm;display:flex;justify-content:space-between;"><span>22.11.2026</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    margin: { top: '18mm', bottom: '16mm', left: '16mm', right: '16mm' },
  });
} finally {
  await browser.close();
}

console.log(`Wrote ${pdfPath}`);
console.log(`Wrote ${htmlPath}`);
