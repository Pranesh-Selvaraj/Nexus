/**
 * In-memory fixtures for the ingestion parser tests. Every container is built
 * from its XML parts at test time: no binary blobs live in the repository and
 * the structure each parser relies on is explicit in the test that uses it.
 */
import JSZip from 'jszip';

export async function zipBuffer(
  files: Record<string, string | Buffer>,
  options: { deflate?: boolean } = {},
): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: options.deflate ? 'DEFLATE' : 'STORE',
  });
}

export async function buildDocx(text: string): Promise<Buffer> {
  return zipBuffer({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`,
  });
}

export async function buildPptx(
  slides: Array<{ body: string[]; notes?: string }>,
): Promise<Buffer> {
  const files: Record<string, string> = {
    'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
  };
  slides.forEach((slide, index) => {
    const number = index + 1;
    const paragraphs = slide.body
      .map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`)
      .join('');
    files[`ppt/slides/slide${number}.xml`] =
      `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;
    if (slide.notes) {
      files[`ppt/notesSlides/notesSlide${number}.xml`] =
        `<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:p><a:r><a:t>${slide.notes}</a:t></a:r></a:p>
</p:notes>`;
    }
  });
  return zipBuffer(files);
}

export async function buildXlsx(
  sheets: Array<{ name: string; rows: string[][] }>,
): Promise<Buffer> {
  const shared: string[] = [];
  const sharedIndex = (value: string): number => {
    const existing = shared.indexOf(value);
    if (existing !== -1) return existing;
    shared.push(value);
    return shared.length - 1;
  };

  const files: Record<string, string> = {};
  const sheetEntries: string[] = [];
  const relEntries: string[] = [];
  sheets.forEach((sheet, index) => {
    const number = index + 1;
    sheetEntries.push(
      `<sheet name="${sheet.name}" sheetId="${number}" r:id="rId${number}"/>`,
    );
    relEntries.push(
      `<Relationship Id="rId${number}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${number}.xml"/>`,
    );
    const rows = sheet.rows
      .map((row, rowIndex) => {
        const cells = row
          .map((cell, cellIndex) => {
            const ref = `${String.fromCharCode(65 + cellIndex)}${rowIndex + 1}`;
            return `<c r="${ref}" t="s"><v>${sharedIndex(cell)}</v></c>`;
          })
          .join('');
        return `<row r="${rowIndex + 1}">${cells}</row>`;
      })
      .join('');
    files[`xl/worksheets/sheet${number}.xml`] =
      `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;
  });

  files['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries.join('')}</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relEntries.join('')}</Relationships>`;
  files['xl/sharedStrings.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<sst>${shared.map((value) => `<si><t>${value}</t></si>`).join('')}</sst>`;

  return zipBuffer(files);
}

export async function buildOdt(
  blocks: Array<{ heading?: string; level?: number; text?: string }>,
): Promise<Buffer> {
  const body = blocks
    .map((block) =>
      block.heading
        ? `<text:h text:outline-level="${block.level ?? 1}">${block.heading}</text:h>`
        : `<text:p>${block.text ?? ''}</text:p>`,
    )
    .join('');
  return zipBuffer({
    mimetype: 'application/vnd.oasis.opendocument.text',
    'META-INF/manifest.xml': `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
</manifest:manifest>`,
    'content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body><office:text>${body}</office:text></office:body>
</office:document-content>`,
  });
}

export async function buildEpub(
  chapters: Array<{ title: string; paragraphs: string[] }>,
  options: { title?: string; author?: string } = {},
): Promise<Buffer> {
  const manifest = chapters
    .map(
      (_chapter, index) =>
        `<item id="ch${index + 1}" href="chapter${index + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join('');
  const spine = chapters
    .map((_chapter, index) => `<itemref idref="ch${index + 1}"/>`)
    .join('');
  const navLinks = chapters
    .map(
      (chapter, index) =>
        `<li><a href="chapter${index + 1}.xhtml">${chapter.title}</a></li>`,
    )
    .join('');

  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${options.title ?? 'Test Book'}</dc:title>
    <dc:creator>${options.author ?? 'Test Author'}</dc:creator>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifest}
  </manifest>
  <spine>${spine}</spine>
</package>`,
    'OEBPS/nav.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol>${navLinks}</ol></nav></body></html>`,
  };
  chapters.forEach((chapter, index) => {
    files[`OEBPS/chapter${index + 1}.xhtml`] =
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${chapter.title}</title></head>
<body><h1>${chapter.title}</h1>${chapter.paragraphs
        .map((paragraph) => `<p>${paragraph}</p>`)
        .join('')}</body></html>`;
  });
  return zipBuffer(files);
}

/** 1x1 PNG (valid signature + IHDR/IDAT/IEND). */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** 1x1 baseline JPEG. */
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiiigD//2Q==',
  'base64',
);

/**
 * Minimal valid PDF with one page per entry (null = blank page), matching the
 * fixture used by the chunking tests.
 */
export function buildPdf(pageTexts: (string | null)[]): Buffer {
  const pageCount = pageTexts.length;
  const fontNum = 3 + pageCount;
  let nextNum = fontNum + 1;
  const contentNumByPage = new Map<number, number>();
  pageTexts.forEach((text, i) => {
    if (text !== null) contentNumByPage.set(i, nextNum++);
  });

  const objects: string[] = new Array<string>(nextNum);
  objects[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const kids = pageTexts.map((_, i) => `${3 + i} 0 R`).join(' ');
  objects[2] = `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`;
  pageTexts.forEach((text, i) => {
    const num = 3 + i;
    objects[num] =
      text === null
        ? `${num} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n`
        : `${num} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentNumByPage.get(i)} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>\nendobj\n`;
  });
  objects[fontNum] =
    `${fontNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;
  pageTexts.forEach((text, i) => {
    if (text === null) return;
    const num = contentNumByPage.get(i) as number;
    const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
    objects[num] =
      `${num} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`;
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(body, 'latin1');
    body += objects[i];
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'latin1');
}
