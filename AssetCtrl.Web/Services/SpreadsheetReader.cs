using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using AssetCtrl.Core;

namespace AssetCtrl.Services
{
    /// <summary>
    /// Reads rows from CSV (UTF-8 or Thai Windows-874/TIS-620) or the first sheet
    /// of an .xlsx workbook. Returns arrays of strings.
    /// </summary>
    public static class SpreadsheetReader
    {
        /// <summary>
        /// Returns a list of rows (each a list of cell strings).
        /// Throws ValidationException.
        /// </summary>
        public static List<List<string>> Read(string path, string originalName)
        {
            string ext = Path.GetExtension(originalName ?? "").TrimStart('.').ToLowerInvariant();
            if (ext == "xlsx")
            {
                return ReadXlsx(path);
            }
            if (ext == "csv" || ext == "txt")
            {
                return ReadCsv(path);
            }
            throw new ValidationException(new[] { "Only .csv or .xlsx files are supported." });
        }

        public static List<List<string>> ReadCsv(string path)
        {
            byte[] bytes;
            try
            {
                bytes = File.ReadAllBytes(path);
            }
            catch (IOException)
            {
                throw new ValidationException(new[] { "Could not read the file." });
            }
            int offset = 0;
            // Strip UTF-8 BOM
            if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
            {
                offset = 3;
            }
            string content;
            try
            {
                content = new UTF8Encoding(false, true).GetString(bytes, offset, bytes.Length - offset);
            }
            catch (DecoderFallbackException)
            {
                // Excel "Save as CSV" on Thai Windows produces Windows-874.
                // (iconv '//IGNORE': undecodable bytes are dropped.)
                string converted = Decode(874, bytes, offset);
                if (string.IsNullOrEmpty(converted))
                {
                    converted = Decode("TIS-620", bytes, offset) ?? converted;
                }
                if (converted == null)
                {
                    throw new ValidationException(new[] { "Unknown character encoding. Please save the file as CSV UTF-8." });
                }
                content = converted;
            }
            char delimiter = DetectDelimiter(content);
            return ParseCsv(content, delimiter);
        }

        private static string Decode(object codePageOrName, byte[] bytes, int offset)
        {
            try
            {
                var fallback = new DecoderReplacementFallback("");
                Encoding enc = codePageOrName is int cp
                    ? Encoding.GetEncoding(cp, EncoderFallback.ReplacementFallback, fallback)
                    : Encoding.GetEncoding((string)codePageOrName, EncoderFallback.ReplacementFallback, fallback);
                return enc.GetString(bytes, offset, bytes.Length - offset);
            }
            catch (ArgumentException)
            {
                return null;
            }
            catch (NotSupportedException)
            {
                return null;
            }
        }

        /// <summary>
        /// fgetcsv($h, 0, $delimiter, '"') over the whole content: enclosure '"', escape '\'
        /// (a backslash keeps the next character literally inside quotes, as PHP does).
        /// Blank lines are skipped.
        /// </summary>
        private static List<List<string>> ParseCsv(string s, char delimiter)
        {
            var rows = new List<List<string>>();
            int n = s.Length;
            int i = 0;
            while (i < n)
            {
                if (s[i] == '\n')
                {
                    i++;
                    continue; // blank line
                }
                if (s[i] == '\r')
                {
                    i++;
                    if (i < n && s[i] == '\n') i++;
                    continue; // blank line
                }
                var record = new List<string>();
                while (true)
                {
                    var sb = new StringBuilder();
                    int j = i;
                    while (j < n && (s[j] == ' ' || s[j] == '\t') && s[j] != delimiter) j++;
                    if (j < n && s[j] == '"')
                    {
                        i = j + 1;
                        while (i < n)
                        {
                            char c = s[i];
                            if (c == '\\' && i + 1 < n)
                            {
                                sb.Append(c).Append(s[i + 1]);
                                i += 2;
                                continue;
                            }
                            if (c == '"')
                            {
                                if (i + 1 < n && s[i + 1] == '"')
                                {
                                    sb.Append('"');
                                    i += 2;
                                    continue;
                                }
                                i++;
                                break;
                            }
                            sb.Append(c);
                            i++;
                        }
                        // Anything after the closing quote up to the delimiter is kept.
                        while (i < n && s[i] != delimiter && s[i] != '\n' && s[i] != '\r')
                        {
                            sb.Append(s[i]);
                            i++;
                        }
                    }
                    else
                    {
                        while (i < n && s[i] != delimiter && s[i] != '\n' && s[i] != '\r')
                        {
                            sb.Append(s[i]);
                            i++;
                        }
                    }
                    record.Add(sb.ToString());
                    if (i < n && s[i] == delimiter)
                    {
                        i++;
                        continue;
                    }
                    if (i < n)
                    {
                        if (s[i] == '\r')
                        {
                            i++;
                            if (i < n && s[i] == '\n') i++;
                        }
                        else
                        {
                            i++;
                        }
                    }
                    break;
                }
                rows.Add(record);
            }
            return rows;
        }

        private static char DetectDelimiter(string content)
        {
            // strtok($content, "\n"): leading newlines are skipped.
            string rest = content.TrimStart('\n');
            int nl = rest.IndexOf('\n');
            string firstLine = nl >= 0 ? rest.Substring(0, nl) : rest;
            var counts = new List<KeyValuePair<char, int>>
            {
                new KeyValuePair<char, int>(',', firstLine.Count(c => c == ',')),
                new KeyValuePair<char, int>(';', firstLine.Count(c => c == ';')),
                new KeyValuePair<char, int>('\t', firstLine.Count(c => c == '\t')),
            };
            var best = counts.OrderByDescending(kv => kv.Value).First();
            return best.Value > 0 ? best.Key : ',';
        }

        public static List<List<string>> ReadXlsx(string path)
        {
            var shared = new List<string>();
            string sheetXml;
            try
            {
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read))
                using (var zip = new ZipArchive(fs, ZipArchiveMode.Read))
                {
                    string ssXml = GetFromName(zip, "xl/sharedStrings.xml");
                    if (ssXml != null)
                    {
                        var ss = XDocument.Parse(ssXml).Root;
                        foreach (var si in Children(ss, "si"))
                        {
                            var t = Children(si, "t").FirstOrDefault();
                            if (t != null)
                            {
                                shared.Add(t.Value);
                            }
                            else
                            {
                                var text = new StringBuilder();
                                foreach (var run in Children(si, "r"))
                                {
                                    var rt = Children(run, "t").FirstOrDefault();
                                    text.Append(rt != null ? rt.Value : "");
                                }
                                shared.Add(text.ToString());
                            }
                        }
                    }
                    string sheetPath = FirstSheetPath(zip);
                    sheetXml = GetFromName(zip, sheetPath);
                }
            }
            catch (InvalidDataException)
            {
                throw new ValidationException(new[] { "Could not open the .xlsx file." });
            }
            catch (IOException)
            {
                throw new ValidationException(new[] { "Could not open the .xlsx file." });
            }
            if (sheetXml == null)
            {
                throw new ValidationException(new[] { "No worksheet found in the .xlsx file." });
            }
            var sheet = XDocument.Parse(sheetXml).Root;
            var rows = new List<List<string>>();
            var sheetData = Children(sheet, "sheetData").FirstOrDefault();
            if (sheetData == null)
            {
                return rows;
            }
            foreach (var row in Children(sheetData, "row"))
            {
                var cells = new Dictionary<int, string>();
                foreach (var c in Children(row, "c"))
                {
                    string reference = Attr(c, "r");
                    int col = ColumnIndex(Regex.Replace(reference, @"\d+", ""));
                    string type = Attr(c, "t");
                    string val;
                    if (type == "s")
                    {
                        int idx = Php.ToInt(ChildValue(c, "v"));
                        val = idx >= 0 && idx < shared.Count ? shared[idx] : "";
                    }
                    else if (type == "inlineStr")
                    {
                        var isEl = Children(c, "is").FirstOrDefault();
                        val = isEl != null ? ChildValue(isEl, "t") : "";
                    }
                    else
                    {
                        val = ChildValue(c, "v");
                    }
                    cells[col] = val;
                }
                if (cells.Count == 0)
                {
                    continue;
                }
                int max = cells.Keys.Max();
                var line = new List<string>();
                for (int i = 0; i <= max; i++)
                {
                    string v;
                    line.Add(cells.TryGetValue(i, out v) ? v : "");
                }
                rows.Add(line);
            }
            return rows;
        }

        private static string FirstSheetPath(ZipArchive zip)
        {
            string wb = GetFromName(zip, "xl/workbook.xml");
            string rels = GetFromName(zip, "xl/_rels/workbook.xml.rels");
            if (wb != null && rels != null)
            {
                var wbXml = XDocument.Parse(wb).Root;
                var relXml = XDocument.Parse(rels).Root;
                var sheetsEl = Children(wbXml, "sheets").FirstOrDefault();
                var first = sheetsEl != null ? Children(sheetsEl, "sheet").FirstOrDefault() : null;
                if (first != null)
                {
                    XNamespace r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
                    var idAttr = first.Attribute(r + "id");
                    string rid = idAttr != null ? idAttr.Value : "";
                    foreach (var rel in Children(relXml, "Relationship"))
                    {
                        if (Attr(rel, "Id") == rid)
                        {
                            string target = Attr(rel, "Target").TrimStart('/');
                            return target.StartsWith("xl/", StringComparison.Ordinal) ? target : "xl/" + target;
                        }
                    }
                }
            }
            return "xl/worksheets/sheet1.xml";
        }

        private static int ColumnIndex(string letters)
        {
            int n = 0;
            letters = letters.ToUpperInvariant();
            for (int i = 0; i < letters.Length; i++)
            {
                n = n * 26 + (letters[i] - 64);
            }
            return n - 1;
        }

        /* ---------------------------------------------- XML / zip helpers (SimpleXML-like) */

        /// <summary>$zip->getFromName(): entry text or null.</summary>
        private static string GetFromName(ZipArchive zip, string name)
        {
            var entry = zip.GetEntry(name);
            if (entry == null)
            {
                return null;
            }
            using (var stream = entry.Open())
            using (var reader = new StreamReader(stream, Encoding.UTF8, true))
            {
                return reader.ReadToEnd();
            }
        }

        /// <summary>Child elements by local name, in the parent's own namespace (as SimpleXML's $el->name).</summary>
        private static IEnumerable<XElement> Children(XElement parent, string name)
        {
            return parent.Elements(parent.Name.Namespace + name);
        }

        private static string ChildValue(XElement parent, string name)
        {
            var el = Children(parent, name).FirstOrDefault();
            return el != null ? el.Value : "";
        }

        private static string Attr(XElement el, string name)
        {
            var a = el.Attribute(name);
            return a != null ? a.Value : "";
        }
    }
}
