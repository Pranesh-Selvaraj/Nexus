import { describe, expect, it } from 'vitest';

import {
  countWords,
  decodeEntities,
  extractArticle,
  extractHtmlTitle,
  readingMinutes,
  selectContentRoot,
  toMarkdown,
} from './readability.js';

const PAGE = `<!DOCTYPE html>
<html>
  <head>
    <title>Hybrid Retrieval Explained</title>
    <meta name="author" content="Ada Lovelace" />
    <meta property="og:site_name" content="Study Notes" />
    <meta name="description" content="How vector and keyword search fuse." />
  </head>
  <body>
    <nav>Home | About | Subscribe</nav>
    <header>Site banner noise</header>
    <article>
      <h1>Hybrid Retrieval Explained</h1>
      <p>Vector search and keyword search find different candidates, so a
      retrieval system benefits from combining them into one ranked list.</p>
      <h2>How fusion works</h2>
      <p>Reciprocal rank fusion rewards passages that both arms rank highly.</p>
      <ul><li>Vectors catch paraphrases</li><li>Keywords catch exact terms</li></ul>
      <table><tr><th>Arm</th><th>Strength</th></tr><tr><td>Vector</td><td>Semantics</td></tr></table>
      <pre><code>const fused = rrf(vector, keyword);</code></pre>
      <a href="javascript:alert(1)">click me</a>
    </article>
    <aside>Related posts you never asked for</aside>
    <footer>Copyright and cookies</footer>
    <script>window.analytics = "tracking";</script>
  </body>
</html>`;

describe('readability extraction', () => {
  it('extracts the article, not the page chrome', () => {
    const article = extractArticle(PAGE);
    expect(article.title).toBe('Hybrid Retrieval Explained');
    expect(article.byline).toBe('Ada Lovelace');
    expect(article.siteName).toBe('Study Notes');
    expect(article.text).toContain('Reciprocal rank fusion');
    expect(article.text).not.toContain('Subscribe');
    expect(article.text).not.toContain('Related posts');
    expect(article.text).not.toContain('window.analytics');
    expect(article.text).not.toContain('javascript:');
    expect(article.wordCount).toBeGreaterThan(20);
    expect(article.readingMinutes).toBe(1);
  });

  it('preserves headings, lists, tables and code fences', () => {
    const text = toMarkdown(selectContentRoot(PAGE));
    expect(text).toContain('## How fusion works');
    expect(text).toContain('- Vectors catch paraphrases');
    expect(text).toContain('| Arm | Strength');
    expect(text).toContain('```');
    expect(text).toContain('const fused = rrf(vector, keyword);');
  });

  it('falls back to the body when there is no article/main', () => {
    const html =
      '<html><body><div><p>' +
      'Sentence with a comma, and more prose. '.repeat(20) +
      '</p></div></body></html>';
    const article = extractArticle(html);
    expect(article.text).toContain('Sentence with a comma');
  });

  it('extracts a title from <title> or <h1>', () => {
    expect(
      extractHtmlTitle('<html><head><title> T </title></head></html>'),
    ).toBe('T');
    expect(extractHtmlTitle('<h1>Heading</h1>')).toBe('Heading');
  });
});

describe('entity decoding', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#65; &#x42; &nbsp;')).toBe(
      'a & b <c> A B  ',
    );
  });

  it('leaves unknown entities and invalid code points alone', () => {
    expect(decodeEntities('&unknown; &#0; &#xD800;')).toBe(
      '&unknown; &#0; &#xD800;',
    );
  });
});

describe('word counting', () => {
  it('counts latin words and CJK characters', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('日本語のテキスト')).toBe(8);
    expect(readingMinutes(400)).toBe(2);
    expect(readingMinutes(1)).toBe(1);
  });
});
