using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using AssetCtrl.Core;

namespace AssetCtrl.Services
{
    /// <summary>
    /// Minimal .xlsx writer (inline strings, bold frozen header, auto-filter,
    /// column widths). Uses System.IO.Compression (the PHP version needed the "zip" extension).
    ///
    ///   var x = new XlsxWriter(headers);          // first sheet ("Assets" unless named)
    ///   x.AddRow(cells);
    ///   x.AddSheet("Movements", headers2);         // optional further sheets; AddRow() then fills that sheet
    ///   x.Save(path);
    ///
    /// Rows are spooled to temp files, so large exports do not sit in memory.
    /// </summary>
    public class XlsxWriter
    {
        private static readonly Encoding Utf8 = new UTF8Encoding(false);

        private class Sheet
        {
            public string Name;
            public List<string> Headers;
            public string File;
            public StreamWriter Handle;
            public int Rows;
            public SortedDictionary<int, int> Widths = new SortedDictionary<int, int>();
        }

        private readonly List<Sheet> _sheets = new List<Sheet>();
        private int _current = -1;

        public static bool Available()
        {
            return true;
        }

        public XlsxWriter(IEnumerable<string> headers, string sheetName = "Assets")
        {
            AddSheet(sheetName, headers);
        }

        /// <summary>Start a new sheet; following AddRow() calls go to it.</summary>
        public void AddSheet(string name, IEnumerable<string> headers)
        {
            string file = Path.GetTempFileName();
            _sheets.Add(new Sheet
            {
                Name = SheetName(name, _sheets.Count + 1),
                Headers = headers.ToList(),
                File = file,
                Handle = new StreamWriter(file, false, Utf8),
                Rows = 0,
            });
            _current = _sheets.Count - 1;
            WriteRow(_sheets[_current].Headers.Cast<object>().ToList(), true);
        }

        public void AddRow(IEnumerable<object> cells)
        {
            WriteRow(cells.ToList(), false);
        }

        private void WriteRow(IList<object> cells, bool isHeader)
        {
            var s = _sheets[_current];
            s.Rows++;
            int r = s.Rows;
            var xml = new StringBuilder();
            xml.Append("<row r=\"").Append(r).Append("\">");
            for (int i = 0; i < cells.Count; i++)
            {
                string reference = ColName(i) + r;
                string value = Php.ToStr(cells[i]);
                int len = Php.MbLen(value);
                int w;
                s.Widths[i] = Math.Max(s.Widths.TryGetValue(i, out w) ? w : 8, Math.Min(60, len + 2));
                string style = isHeader ? " s=\"1\"" : "";
                if (value == "")
                {
                    xml.Append("<c r=\"").Append(reference).Append("\"").Append(style).Append("/>");
                    continue;
                }
                xml.Append("<c r=\"").Append(reference).Append("\" t=\"inlineStr\"").Append(style).Append("><is><t xml:space=\"preserve\">")
                    .Append(Esc(value)).Append("</t></is></c>");
            }
            xml.Append("</row>");
            s.Handle.Write(xml.ToString());
        }

        /// <summary>Write the workbook to path.</summary>
        public void Save(string path)
        {
            var overrides = new StringBuilder();
            var sheetsXml = new StringBuilder();
            var names = new StringBuilder();
            var rels = new StringBuilder();
            for (int n = 0; n < _sheets.Count; n++)
            {
                var s = _sheets[n];
                int no = n + 1;
                string lastCol = ColName(Math.Max(0, s.Headers.Count - 1));
                overrides.Append("<Override PartName=\"/xl/worksheets/sheet" + no + ".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
                sheetsXml.Append("<sheet name=\"" + Esc(s.Name) + "\" sheetId=\"" + no + "\" r:id=\"rId" + no + "\"/>");
                names.Append("<definedName name=\"_xlnm._FilterDatabase\" localSheetId=\"" + n + "\" hidden=\"1\">'"
                    + Esc(s.Name.Replace("'", "''")) + "'!$A$1:$" + lastCol + "$" + s.Rows + "</definedName>");
                rels.Append("<Relationship Id=\"rId" + no + "\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet" + no + ".xml\"/>");
            }
            int stylesId = _sheets.Count + 1;

            using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write))
            using (var zip = new ZipArchive(fs, ZipArchiveMode.Create))
            {
                AddFromString(zip, "[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                    + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                    + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                    + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>"
                    + overrides
                    + "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>"
                    + "</Types>");
                AddFromString(zip, "_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                    + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>"
                    + "</Relationships>");
                AddFromString(zip, "xl/workbook.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
                    + "<sheets>" + sheetsXml + "</sheets><definedNames>" + names + "</definedNames></workbook>");
                AddFromString(zip, "xl/_rels/workbook.xml.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                    + rels
                    + "<Relationship Id=\"rId" + stylesId + "\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>"
                    + "</Relationships>");
                AddFromString(zip, "xl/styles.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
                    + "<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Tahoma\"/></font><font><b/><sz val=\"11\"/><name val=\"Tahoma\"/></font></fonts>"
                    + "<fills count=\"3\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill>"
                    + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFEDEBE6\"/></patternFill></fill></fills>"
                    + "<borders count=\"1\"><border/></borders>"
                    + "<cellStyleXfs count=\"1\"><xf/></cellStyleXfs>"
                    + "<cellXfs count=\"2\"><xf fontId=\"0\" fillId=\"0\" borderId=\"0\"/><xf fontId=\"1\" fillId=\"2\" borderId=\"0\" applyFont=\"1\" applyFill=\"1\"/></cellXfs>"
                    + "</styleSheet>");

                // Assemble each sheet from its spooled rows without loading it all into memory
                // (streamed straight into the zip entry instead of via a second temp file).
                for (int n = 0; n < _sheets.Count; n++)
                {
                    var s = _sheets[n];
                    s.Handle.Dispose();
                    s.Handle = null;
                    string lastCol = ColName(Math.Max(0, s.Headers.Count - 1));
                    var cols = new StringBuilder("<cols>");
                    foreach (var kv in s.Widths)
                    {
                        cols.Append("<col min=\"" + (kv.Key + 1) + "\" max=\"" + (kv.Key + 1) + "\" width=\"" + kv.Value + "\" customWidth=\"1\"/>");
                    }
                    cols.Append("</cols>");
                    var entry = zip.CreateEntry("xl/worksheets/sheet" + (n + 1) + ".xml");
                    using (var output = entry.Open())
                    {
                        WriteString(output, "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                            + "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
                            + "<sheetViews><sheetView workbookViewId=\"0\"" + (n == 0 ? " tabSelected=\"1\"" : "") + "><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews>"
                            + cols + "<sheetData>");
                        using (var input = new FileStream(s.File, FileMode.Open, FileAccess.Read))
                        {
                            input.CopyTo(output);
                        }
                        WriteString(output, "</sheetData><autoFilter ref=\"A1:" + lastCol + s.Rows + "\"/></worksheet>");
                    }
                }
            }
            foreach (var s in _sheets)
            {
                try { File.Delete(s.File); } catch { }
            }
        }

        private static void AddFromString(ZipArchive zip, string name, string content)
        {
            var entry = zip.CreateEntry(name);
            using (var stream = entry.Open())
            {
                WriteString(stream, content);
            }
        }

        private static void WriteString(Stream stream, string content)
        {
            var bytes = Utf8.GetBytes(content);
            stream.Write(bytes, 0, bytes.Length);
        }

        /// <summary>Excel sheet names: max 31 chars, none of : \ / ? * [ ]</summary>
        private static string SheetName(string name, int no)
        {
            name = Regex.Replace(name ?? "", @"[:\\/?*\[\]]", " ").Trim();
            if (name == "")
            {
                name = "Sheet" + no;
            }
            return Php.MbLeft(name, 31);
        }

        private static string Esc(string s)
        {
            // Strip characters that are illegal in XML 1.0.
            s = Regex.Replace(s ?? "", @"[\x00-\x08\x0B\x0C\x0E-\x1F]", "");
            return s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&apos;");
        }

        public static string ColName(int index)
        {
            string name = "";
            index++;
            while (index > 0)
            {
                int mod = (index - 1) % 26;
                name = (char)(65 + mod) + name;
                index = (index - mod) / 26;
            }
            return name;
        }
    }
}
