/**
 * Markdown → DOCX 转换脚本
 * 用法：node scripts/convert-md-to-docx.js <输入md路径> [输出docx路径]
 * 示例：node scripts/convert-md-to-docx.js "doc/合作对接/xxx.md" "output/xxx.docx"
 */
const fs = require("fs");
const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
  convertInchesToTwip,
  PageBorderDisplay,
  PageBorderZOrder,
} = require("docx");

// ========== Markdown 解析器 ==========

function parseMarkdown(text) {
  const lines = text.split("\n");
  return parseBlocks(lines, 0).blocks;
}

function parseBlocks(lines, startIdx) {
  const blocks = [];
  let i = startIdx;
  while (i < lines.length) {
    const raw = lines[i];

    // 空行
    if (raw.trim() === "") {
      i++;
      continue;
    }

    // 代码块 ```
    if (raw.trim().startsWith("```")) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: "code", content: codeLines.join("\n") });
      continue;
    }

    // 表格 |
    if (raw.includes("|") && raw.trim().startsWith("|")) {
      const tableLines = [raw];
      i++;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "table", content: tableLines });
      continue;
    }

    // 标题
    const headingMatch = raw.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push({ type: "heading", level, text: headingMatch[2].trim() });
      i++;
      continue;
    }

    // 水平线
    if (/^-{3,}$/.test(raw.trim()) || /^\*{3,}$/.test(raw.trim())) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // 引用 >
    if (raw.trim().startsWith(">")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", content: quoteLines.join("\n") });
      continue;
    }

    // 无序列表 - * / +
    if (/^[\s]*[-*+]\s+/.test(raw)) {
      const listItems = [];
      while (i < lines.length && /^[\s]*[-*+]\s+/.test(lines[i])) {
        listItems.push(lines[i].trim().replace(/^[\s]*[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items: listItems });
      continue;
    }

    // 有序列表 1. / 1)
    if (/^[\s]*\d+[.)]\s+/.test(raw)) {
      const listItems = [];
      while (i < lines.length && /^[\s]*\d+[.)]\s+/.test(lines[i])) {
        listItems.push(lines[i].trim().replace(/^[\s]*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items: listItems });
      continue;
    }

    // 普通段落
    blocks.push({ type: "paragraph", text: raw.trim() });
    i++;
  }
  return { blocks, endIdx: i };
}

// ========== Inline 解析（加粗、斜体、链接） ==========

function parseInline(text) {
  const runs = [];
  let remaining = text;
  while (remaining.length > 0) {
    // 加粗 **text**
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/);
    if (boldMatch) {
      if (boldMatch[1]) runs.push(new TextRun(boldMatch[1]));
      runs.push(new TextRun({ text: boldMatch[2], bold: true }));
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // 加粗 __text__
    const boldMatch2 = remaining.match(/^(.*?)__(.+?)__/);
    if (boldMatch2) {
      if (boldMatch2[1]) runs.push(new TextRun(boldMatch2[1]));
      runs.push(new TextRun({ text: boldMatch2[2], bold: true }));
      remaining = remaining.slice(boldMatch2[0].length);
      continue;
    }

    // 斜体 *text*
    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*/);
    if (italicMatch && italicMatch[1] !== "**" && italicMatch[2] !== "**") {
      if (italicMatch[1]) runs.push(new TextRun(italicMatch[1]));
      runs.push(new TextRun({ text: italicMatch[2], italics: true }));
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // 行内代码 `text`
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`/);
    if (codeMatch) {
      if (codeMatch[1]) runs.push(new TextRun(codeMatch[1]));
      runs.push(new TextRun({ text: codeMatch[2], font: "Courier New", size: 18 }));
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // 链接 [text](url)
    const linkMatch = remaining.match(/^(.*?)\[(.+?)\]\((.+?)\)/);
    if (linkMatch) {
      if (linkMatch[1]) runs.push(new TextRun(linkMatch[1]));
      runs.push(new TextRun({ text: linkMatch[2], style: "Hyperlink", color: "0563C1", underline: {} }));
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // 普通文本
    runs.push(new TextRun(remaining));
    break;
  }
  return runs;
}

// ========== 表格解析 ==========

function parseTableLines(lines) {
  if (lines.length < 2) return null;

  // 解析表头
  const headerCells = lines[0]
    .split("|")
    .filter((c) => c.trim() !== "")
    .map((c) => c.trim());

  // 跳过分隔符行 (|---|---|)
  let bodyStart = 1;
  if (lines[1] && /^[\s|:-]+$/.test(lines[1].replace(/\|/g, "").replace(/:/g, "").replace(/-/g, "").trim())) {
    bodyStart = 2;
  }

  const rows = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const cells = lines[i]
      .split("|")
      .filter((c) => c.trim() !== "")
      .map((c) => c.trim());
    if (cells.length > 0) rows.push(cells);
  }

  return { headerCells, rows };
}

// ========== 构建 DOCX ==========

function buildDocument(blocks) {
  const children = [];

  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        const levelMap = {
          1: HeadingLevel.HEADING_1,
          2: HeadingLevel.HEADING_2,
          3: HeadingLevel.HEADING_3,
          4: HeadingLevel.HEADING_4,
          5: HeadingLevel.HEADING_5,
          6: HeadingLevel.HEADING_6,
        };
        children.push(
          new Paragraph({
            heading: levelMap[block.level] || HeadingLevel.HEADING_1,
            children: parseInline(block.text),
            spacing: { before: 240, after: 120 },
          })
        );
        break;
      }

      case "paragraph": {
        children.push(
          new Paragraph({
            children: parseInline(block.text),
            spacing: { after: 120 },
          })
        );
        break;
      }

      case "code": {
        const codeLines = block.content.split("\n");
        codeLines.forEach((line) => {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: line, font: "Courier New", size: 18 })],
              spacing: { after: 0, before: 0 },
              shading: { type: ShadingType.SOLID, color: "F2F2F2", fill: "F2F2F2" },
              indent: { left: convertInchesToTwip(0.3) },
            })
          );
        });
        break;
      }

      case "blockquote": {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: block.content, italics: true, color: "595959" })],
            spacing: { after: 120 },
            indent: { left: convertInchesToTwip(0.5) },
            border: { left: { style: BorderStyle.SINGLE, color: "CCCCCC", size: 3, space: 8 } },
          })
        );
        break;
      }

      case "ul": {
        for (const item of block.items) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: "• " }), ...parseInline(item)],
              spacing: { after: 60 },
              indent: { left: convertInchesToTwip(0.4) },
              bullet: { level: 0 },
            })
          );
        }
        break;
      }

      case "ol": {
        for (let j = 0; j < block.items.length; j++) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: `${j + 1}. ` }), ...parseInline(block.items[j])],
              spacing: { after: 60 },
              indent: { left: convertInchesToTwip(0.4) },
            })
          );
        }
        break;
      }

      case "hr": {
        children.push(
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, color: "CCCCCC", size: 2, space: 6 } },
            spacing: { before: 200, after: 200 },
          })
        );
        break;
      }

      case "table": {
        const parsed = parseTableLines(block.content);
        if (!parsed) break;

        const { headerCells, rows } = parsed;
        const colCount = headerCells.length;

        // 计算每列最长字符数，用于智能分配列宽
        const colCharLengths = headerCells.map((h, ci) => {
          let max = h.length;
          rows.forEach((r) => {
            if (r[ci] && r[ci].length > max) max = r[ci].length;
          });
          return max;
        });
        const totalChars = colCharLengths.reduce((s, v) => s + v, 1);
        // 列宽按比例分配，最小不低于 8%
        const getColPct = (ci) => Math.max(8, Math.round((colCharLengths[ci] / totalChars) * 100));

        // 通用单元格边框
        const cellBorder = {
          top: { style: BorderStyle.SINGLE, size: 1, color: "808080" },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: "808080" },
          left: { style: BorderStyle.SINGLE, size: 1, color: "808080" },
          right: { style: BorderStyle.SINGLE, size: 1, color: "808080" },
        };

        // 通用 cell padding（上下）
        const cellPad = { before: 50, after: 50 };
        const cellPadTight = { before: 40, after: 40 };

        // 表头：浅灰底 + 加粗深灰字 + 居中对齐
        const headerRow = new TableRow({
          tableHeader: true,
          children: headerCells.map((c, ci) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: parseInline(c).map((r) => {
                    // 确保表头文字加粗
                    const opts = typeof r === "object" && r.options ? { ...r.options, bold: true } : { text: r.text || r, bold: true };
                    return new TextRun(opts);
                  }),
                  alignment: AlignmentType.CENTER,
                  spacing: cellPad,
                }),
              ],
              shading: { type: ShadingType.SOLID, color: "E8E8E8", fill: "E8E8E8" },
              width: { size: getColPct(ci), type: WidthType.PERCENTAGE },
              borders: cellBorder,
            })
          ),
        });

        // 数据行
        const dataRows = rows.map((row, idx) =>
          new TableRow({
            children: row.map((c, ci) => {
              // 判断该单元格是否需要左对齐（长文本列）还是居中（短文本列）
              const cellLen = c ? c.length : 0;
              const isLong = cellLen > 10;
              return new TableCell({
                children: [
                  new Paragraph({
                    children: parseInline(c),
                    alignment: isLong ? AlignmentType.LEFT : AlignmentType.CENTER,
                    spacing: cellPadTight,
                  }),
                ],
                width: { size: getColPct(ci), type: WidthType.PERCENTAGE },
                borders: cellBorder,
                // 斑马纹用极浅灰
                shading:
                  idx % 2 === 0
                    ? undefined
                    : { type: ShadingType.SOLID, color: "F5F5F5", fill: "F5F5F5" },
              });
            }),
          })
        );

        children.push(
          new Table({
            rows: [headerRow, ...dataRows],
            width: { size: 100, type: WidthType.PERCENTAGE },
          })
        );
        // 表格后加空行
        children.push(new Paragraph({ spacing: { after: 140 }, children: [] }));
        break;
      }
    }
  }

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: "Microsoft YaHei", size: 21 }, // 五号 ≈ 10.5pt = 21 half-points
        },
      },
    },
    sections: [
      {
        children,
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.8),
              bottom: convertInchesToTwip(0.8),
              left: convertInchesToTwip(1.0),
              right: convertInchesToTwip(1.0),
            },
          },
        },
      },
    ],
  });
}

// ========== 主流程 ==========

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("用法：node scripts/convert-md-to-docx.js <输入md路径> [输出docx路径]");
    process.exit(1);
  }

  const absInput = path.resolve(inputPath);
  if (!fs.existsSync(absInput)) {
    console.error(`文件不存在：${absInput}`);
    process.exit(1);
  }

  const outputPath = process.argv[3] || absInput.replace(/\.md$/i, ".docx");
  const absOutput = path.resolve(outputPath);

  console.log(`📄 读取：${absInput}`);
  const mdContent = fs.readFileSync(absInput, "utf-8");

  console.log("🔍 解析 Markdown...");
  const blocks = parseMarkdown(mdContent);

  console.log(`📦 构建 DOCX（共 ${blocks.length} 个 block）...`);
  const doc = buildDocument(blocks);

  console.log("💾 写入...");
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(absOutput, buffer);

  console.log(`✅ 完成：${absOutput}`);
}

main().catch((err) => {
  console.error("❌ 转换失败：", err);
  process.exit(1);
});
