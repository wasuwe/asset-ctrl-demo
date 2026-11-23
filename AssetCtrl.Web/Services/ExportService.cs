using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Web;
using AssetCtrl.Core;
using AssetCtrl.Models;

namespace AssetCtrl.Services
{
    /// <summary>
    /// Streams assets as .xlsx or CSV (UTF-8 with BOM so Excel shows Thai correctly).
    ///
    /// Every export can be imported again (Admin &gt; Import):
    ///  - only importable columns (AssetFields.Exportable), asset_no always first (the import key);
    ///  - headers are the English field labels, which Import recognises (AssetFields.HeaderAliases);
    ///  - Work Center is written as "2300-ICS" so the name comes back too; status is written as its code.
    /// </summary>
    public class ExportService
    {
        private static readonly Encoding Utf8 = new UTF8Encoding(false);

        /// <summary>
        /// Writes the file to the response and ends the request (throws ResponseSentException, like PHP exit).
        /// </summary>
        /// <param name="rows">rows to export (AssetRepository.Cursor)</param>
        /// <param name="columns">field keys</param>
        /// <param name="format">csv | xlsx</param>
        /// <param name="basename">file name without extension</param>
        /// <param name="response">HTTP response to write to</param>
        /// <param name="raw">true = a report, not a re-importable file (e.g. the audit export):
        /// keep columns exactly as given and translate headers and values</param>
        /// <param name="labels">raw only: header label per column (default AssetFields.Label)</param>
        /// <param name="valueMaps">raw only: column => {stored value => label}, e.g. audit result codes</param>
        public void Stream(IEnumerable<Row> rows, IEnumerable<string> columns, string format, string basename, HttpResponse response,
            bool raw = false, IDictionary<string, string> labels = null, IDictionary<string, IDictionary<string, string>> valueMaps = null)
        {
            var cols = raw ? columns.Select(c => c ?? "").ToList() : KnownColumns(columns);
            var headers = cols.Select(c =>
            {
                string label = labels != null && labels.ContainsKey(c) ? labels[c] : AssetFields.Label(c);
                // Re-importable files keep English headers (Import recognises them); reports follow the user's language.
                return raw ? Lang.T(label) : label;
            }).ToList();
            _valueMaps = raw ? valueMaps : null;
            string filename = basename + "-" + Database.NowDate().ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);

            response.ClearContent();
            response.StatusCode = 200;
            // Cache-Control: no-store is already set by the Kernel for every response.

            if (format == "xlsx" && XlsxWriter.Available())
            {
                var writer = new XlsxWriter(headers);
                foreach (var row in rows)
                {
                    writer.AddRow(Line(row, cols));
                }
                string tmp = Path.GetTempFileName();
                byte[] bytes;
                try
                {
                    writer.Save(tmp);
                    bytes = File.ReadAllBytes(tmp);
                }
                finally
                {
                    try { File.Delete(tmp); } catch { }
                }
                response.ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                response.Charset = "";
                response.AddHeader("Content-Disposition", "attachment; filename=\"" + filename + ".xlsx\"");
                response.AddHeader("Content-Length", bytes.Length.ToString(CultureInfo.InvariantCulture));
                response.BinaryWrite(bytes);
                throw new ResponseSentException();
            }

            var csv = new StringBuilder();
            csv.Append('﻿');
            PutCsv(csv, headers);
            foreach (var row in rows)
            {
                PutCsv(csv, Line(row, cols));
            }
            response.ContentType = "text/csv";
            response.Charset = "utf-8";
            response.AddHeader("Content-Disposition", "attachment; filename=\"" + filename + ".csv\"");
            response.BinaryWrite(Utf8.GetBytes(csv.ToString()));
            throw new ResponseSentException();
        }

        /// <summary>
        /// Keep only exportable (= importable) columns, in register order, with asset_no first.
        /// Unknown / non-importable columns (e.g. from an old saved link) are dropped.
        /// </summary>
        public static List<string> KnownColumns(IEnumerable<string> columns)
        {
            var wanted = new HashSet<string>(columns.Select(c => c ?? ""));
            var o = new List<string> { "asset_no" };
            foreach (var c in AssetFields.Exportable())
            {
                if (c != "asset_no" && wanted.Contains(c))
                {
                    o.Add(c);
                }
            }
            return o.Count > 1 ? o : AssetFields.Exportable();
        }

        /// <summary>Raw exports: column => {stored value => label}.</summary>
        private IDictionary<string, IDictionary<string, string>> _valueMaps;

        private List<string> Line(Row row, List<string> columns)
        {
            var line = new List<string>();
            foreach (var c in columns)
            {
                string v;
                if (c == "work_center" && row.ContainsKey("department"))
                {
                    v = row.Str("department"); // "2300-ICS" (asset list export)
                }
                else
                {
                    v = row.Str(c); // e.g. audit export: code only, name in work_center_name
                }
                IDictionary<string, string> map;
                if (_valueMaps != null && _valueMaps.TryGetValue(c, out map) && map.ContainsKey(v))
                {
                    v = Lang.T(map[v]);
                }
                // Neutralise spreadsheet formula injection.
                if (v != "" && (v[0] == '=' || v[0] == '+' || v[0] == '@'))
                {
                    v = "'" + v;
                }
                line.Add(v);
            }
            return line;
        }

        /// <summary>
        /// fputcsv($out, $fields): delimiter ',', enclosure '"', escape '\', line end "\n".
        /// A field is enclosed when it holds , " \ \n \r \t or a space; a quote is doubled
        /// unless it follows the escape character (PHP behaviour).
        /// </summary>
        private static void PutCsv(StringBuilder sb, IList<string> fields)
        {
            for (int i = 0; i < fields.Count; i++)
            {
                if (i > 0) sb.Append(',');
                string f = fields[i] ?? "";
                if (f.IndexOfAny(new[] { ',', '"', '\\', '\n', '\r', '\t', ' ' }) < 0)
                {
                    sb.Append(f);
                    continue;
                }
                sb.Append('"');
                bool escaped = false;
                foreach (char ch in f)
                {
                    if (ch == '\\')
                    {
                        escaped = true;
                    }
                    else if (!escaped && ch == '"')
                    {
                        sb.Append('"');
                    }
                    else
                    {
                        escaped = false;
                    }
                    sb.Append(ch);
                }
                sb.Append('"');
            }
            sb.Append('\n');
        }
    }
}
