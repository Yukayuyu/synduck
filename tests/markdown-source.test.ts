import { describe, expect, it } from 'vitest';
import { parseMarkdown, sourceRuns } from '../apps/web/src/markdown-source';

describe('Markdown source positions', () => {
  const fixtures = [
    '# 标题🙂\n\n**粗体🙂** 与 _斜体_，重复：粗体🙂。\n\n- [x] 已完成\n- 引用 [链接](https://example.test)',
    '> 引用 &amp; 实体 &#x1F642;\n> 第二行 \\*不是强调\\*。\n\n1. 第一项\n   下一行\n2. 第二项',
    '行内 \x60 a  b \x60，双分隔符 \x60\x60x \x60 y\x60\x60，换行 \x60a\nb\x60。',
    '~~~typescript\nconst a = "**literal**";\n  console.log(a);\n~~~',
    '    const a = 1;\n    console.log(a);\n\n> ~~~ts\n> const b = 2;\n> ~~~',
    '| 名称 | 值 |\n| --- | ---: |\n| **重复** | &lt;x&gt; |\n\n![图片文字](https://example.test/image.png)',
    '# CRLF\r\n\r\n**保持** &amp;\r\n下一行。\r\n\r\n~~~js\r\nconst x = 1;\r\n~~~',
    '<script>window.evil = true</script>\n\n[链接][id]\n\n[id]: https://example.test "标题"',
  ];
  it.each(fixtures)('preserves exact UTF-16 source ranges for %s', (source) => {
    const root = parseMarkdown(source);
    const visit = (node: Parameters<typeof sourceRuns>[1]) => {
      if (['text', 'inlineCode', 'code', 'html', 'image'].includes(node.type)) {
        const original = 'value' in node ? node.value : node.type === 'image' ? node.alt : '';
        const expected =
          node.type === 'inlineCode' ? original?.replace(/\r\n?|\n/g, ' ') : original;
        const runs = sourceRuns(source, node);
        expect(runs.map((run) => run.text).join('')).toBe(expected);
        for (const run of runs) {
          expect(run.start).toBeGreaterThanOrEqual(node.position!.start.offset!);
          expect(run.end).toBeLessThanOrEqual(node.position!.end.offset!);
          if (!run.atomic) expect(source.slice(run.start, run.end)).toBe(run.text);
        }
      }
      if ('children' in node) node.children.forEach(visit);
    };
    visit(root);
  });
  it('maps literal container characters inside code to content instead of the blockquote prefix', () => {
    const source = '> ~~~txt\n> >hello\n> ~~~';
    const quote = parseMarkdown(source).children[0];
    if (quote.type !== 'blockquote') throw new Error('Missing quote');
    const code = quote.children[0];
    const runs = sourceRuns(source, code);
    expect(runs[0].start).toBe(source.indexOf('>hello'));
    expect(runs.map((run) => run.text).join('')).toBe('>hello');
  });
});
