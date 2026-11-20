const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity] ?? entity);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '');
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function domToMarkdown(root: ParentNode): string {
  function renderChildren(element: Element, depth: number, skipLists = false): string {
    return Array.from(element.childNodes)
      .map((child) => renderNode(child, depth, skipLists))
      .join('');
  }

  function renderList(list: Element, depth: number, ordered: boolean): string {
    const items = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === 'li');
    const lines: string[] = [];
    let index = 1;
    for (const item of items) {
      const inline: string[] = [];
      const nested: string[] = [];
      for (const child of Array.from(item.childNodes)) {
        const childTag = child.nodeType === 1 ? (child as Element).tagName.toLowerCase() : '';
        if (childTag === 'ul' || childTag === 'ol') {
          nested.push(renderList(child as Element, depth + 1, childTag === 'ol'));
        } else {
          inline.push(renderNode(child, depth, false));
        }
      }
      const content = inline.join('').replace(/\n+/g, ' ').trim();
      const prefix = ordered ? `${index++}. ` : '- ';
      lines.push(`${'  '.repeat(depth)}${prefix}${content}`);
      for (const nestedLine of nested) {
        if (nestedLine.trim()) lines.push(nestedLine.trim());
      }
    }
    return `\n${lines.join('\n')}\n`;
  }

  function renderNode(node: Node, depth: number, skipLists: boolean): string {
    if (node.nodeType === 3) return node.nodeValue ?? '';
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return '';
    if (tag === 'br') return '\n';
    if (tag === 'img') {
      const alt = element.getAttribute('alt') ?? '';
      const src = element.getAttribute('src') ?? '';
      return src ? `![${alt}](${src})` : '';
    }
    if (tag === 'ul' || tag === 'ol') {
      return skipLists ? '' : renderList(element, depth, tag === 'ol');
    }
    if (tag === 'li') return renderChildren(element, depth, skipLists);
    const inner = renderChildren(element, depth, skipLists);
    if (tag === 'strong' || tag === 'b') return `**${inner}**`;
    if (tag === 'em' || tag === 'i') return `*${inner}*`;
    if (tag === 'span') {
      const style = (element.getAttribute('style') ?? '').toLowerCase();
      if (/font-weight:\s*(bold|[6-9]00)/.test(style)) return `**${inner}**`;
      if (/font-style:\s*italic/.test(style)) return `*${inner}*`;
    }
    if (tag === 'code') return `\`${element.textContent ?? ''}\``;
    if (tag === 'pre') return `\n\`\`\`\n${element.textContent ?? ''}\n\`\`\`\n`;
    if (tag === 'a') {
      const href = element.getAttribute('href');
      return href ? `[${inner.trim()}](${href})` : inner;
    }
    if (/^h[1-6]$/.test(tag)) {
      return `\n${'#'.repeat(Number(tag[1]))} ${inner.trim()}\n`;
    }
    if (tag === 'blockquote') {
      return `\n> ${inner.trim().replace(/\n/g, '\n> ')}\n`;
    }
    if (['p', 'div', 'section', 'article', 'tr'].includes(tag)) return `${inner}\n`;
    return inner;
  }

  return renderChildren(root as Element, 0);
}

function regexToMarkdown(html: string): string {
  let text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  text = text.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href: string, label: string) => `[${stripTags(label).trim()}](${href})`,
  );
  text = text.replace(
    /<img\b[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*>/gi,
    (_, alt: string, src: string) => `![${alt}](${src})`,
  );

  text = text
    .replace(/<h1\b[^>]*>/gi, '\n# ')
    .replace(/<h2\b[^>]*>/gi, '\n## ')
    .replace(/<h[3-6]\b[^>]*>/gi, '\n### ')
    .replace(/<blockquote\b[^>]*>/gi, '\n> ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(h[1-6]|p|div|section|article|blockquote|tr)>/gi, '\n');

  text = text.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner: string) => {
    let index = 0;
    return `${inner.replace(
      /<li\b[^>]*>([\s\S]*?)<\/li>/gi,
      (__, item: string) => `\n${++index}. ${item.trim()}`,
    )}\n`;
  });
  text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, item: string) => `\n- ${item.trim()}`);

  text = text
    .replace(/<(strong|b)\b[^>]*>/gi, '**')
    .replace(/<\/(strong|b)>/gi, '**')
    .replace(/<(em|i)\b[^>]*>/gi, '*')
    .replace(/<\/(em|i)>/gi, '*')
    .replace(/<code\b[^>]*>/gi, '`')
    .replace(/<\/code>/gi, '`')
    .replace(/<[^>]+>/g, '');

  return normalizeMarkdown(decodeEntities(text).replace(/\u00a0/g, ' '));
}

export function htmlToMarkdown(html: string): string {
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return normalizeMarkdown(domToMarkdown(doc.body));
    } catch {
      // Fall back to the regex converter below.
    }
  }
  return regexToMarkdown(html);
}
