import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttachmentsPanel } from './attachments-panel';

const image = {
  id: 'image-1',
  name: 'chart.jpg',
  mimeType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,AAAA',
  sizeBytes: 1024,
};

const file = {
  id: 'file-1',
  name: 'report.pdf',
  mimeType: 'application/pdf',
  dataUrl: 'data:application/pdf;base64,JVBERi0=',
  sizeBytes: 2048,
};

describe('AttachmentsPanel', () => {
  it('renders the shared empty state and add button', () => {
    const html = renderToStaticMarkup(
      <AttachmentsPanel items={[]} editable onFiles={() => undefined} />,
    );

    expect(html).toContain('Файлы');
    expect(html).toContain('Добавить файл');
    expect(html).toContain('Пока нет файлов');
  });

  it('renders image thumbnails and downloadable file cards', () => {
    const html = renderToStaticMarkup(
      <AttachmentsPanel
        items={[image, file]}
        editable={false}
        onFiles={() => undefined}
        onRemove={() => undefined}
      />,
    );

    expect(html).toContain('chart.jpg');
    expect(html).toContain('report.pdf');
    expect(html).toContain('download="report.pdf"');
    expect(html).not.toContain('Пока нет файлов');
  });
});
