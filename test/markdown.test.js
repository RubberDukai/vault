'use strict';
/**
 * The markdown renderer writes every page the vault authors itself — the
 * handbook, the lessons, the manual. These tests pin the things that have
 * actually gone wrong: unescaped HTML, tables losing a cell to a pipe inside
 * it, and wiki: links not being marked for the client to resolve.
 */

const test = require('node:test');
const assert = require('node:assert');
const { render, inline, escapeHtml, toPlainText } = require('../src/content/markdown');

test('escapes HTML in ordinary text', () => {
  const html = render('A <script>alert(1)</script> tag.');
  assert.ok(!html.includes('<script>'), 'script tag must not survive');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('escapeHtml covers the five characters that matter', () => {
  assert.strictEqual(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
});

test('headings become h1..h3 with their text', () => {
  const html = render('# One\n\n## Two\n\n### Three\n');
  assert.match(html, /<h1[^>]*>One<\/h1>/);
  assert.match(html, /<h2[^>]*>Two<\/h2>/);
  assert.match(html, /<h3[^>]*>Three<\/h3>/);
});

test('bullet and numbered lists render as ul and ol', () => {
  const ul = render('- one\n- two\n');
  assert.match(ul, /<ul>[\s\S]*<li>one<\/li>[\s\S]*<li>two<\/li>[\s\S]*<\/ul>/);
  const ol = render('1. first\n2. second\n');
  assert.match(ol, /<ol>[\s\S]*<li>first<\/li>/);
});

test('emphasis, strong and inline code', () => {
  assert.match(inline('*a* **b** `c`'), /<em>a<\/em>/);
  assert.match(inline('*a* **b** `c`'), /<strong>b<\/strong>/);
  assert.match(inline('*a* **b** `c`'), /<code>c<\/code>/);
});

test('inline code is escaped, not executed', () => {
  assert.match(inline('`<b>`'), /<code>&lt;b&gt;<\/code>/);
});

test('fenced code blocks keep their content verbatim', () => {
  const html = render('```\n3x + 7 = 22\n```\n');
  assert.match(html, /<pre[^>]*>/);
  assert.ok(html.includes('3x + 7 = 22'));
});

test('blockquotes render', () => {
  assert.match(render('> quoted line\n'), /<blockquote/);
});

test('tables render a header row and body rows', () => {
  const html = render('| a | b |\n|---|---|\n| 1 | 2 |\n');
  assert.match(html, /<th>a<\/th>/);
  assert.match(html, /<td>1<\/td>/);
  assert.ok(!html.includes('---'), 'the separator row must not become a body row');
});

test('a cell may contain an escaped pipe', () => {
  // wiki:Iron_Age_Britain|Celts offers an alternative title; without the
  // escape the row gained a cell and the link was cut in half.
  const html = render('| a | b |\n|---|---|\n| [x](wiki:Foo\\|Bar) | y |\n');
  const cells = html.match(/<td>/g) || [];
  assert.strictEqual(cells.length, 2, 'the row must still have two cells');
  assert.ok(html.includes('wiki:Foo|Bar'), 'the pipe must survive inside the link');
});

test('wiki: links are marked for the client to resolve', () => {
  const html = render('See [poetry](wiki:Poetry).');
  assert.match(html, /class="wiki-link"/);
  assert.match(html, /href="wiki:Poetry"/);
});

test('ordinary links survive and javascript: ones do not become live', () => {
  assert.match(render('[a](#/school)'), /href="#\/school"/);
  const html = render('[x](javascript:alert(1))');
  assert.ok(!/href="javascript:alert\(1\)"/.test(html), 'javascript: URLs must not be emitted as-is');
});

test('toPlainText strips the markup for the search index', () => {
  const plain = toPlainText('# Title\n\nSome **bold** and `code` and [a link](#/x).\n');
  assert.ok(!plain.includes('**'));
  assert.ok(!plain.includes('#'));
  assert.ok(plain.includes('bold'));
});
