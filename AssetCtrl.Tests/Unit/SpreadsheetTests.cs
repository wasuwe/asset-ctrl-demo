using System.IO;
using System.Text;
using AssetCtrl.Core;
using AssetCtrl.Services;
using Xunit;

namespace AssetCtrl.Tests.Unit
{
    /// <summary>Files written by Export must read back the same through Import.</summary>
    public class SpreadsheetTests
    {
        [Fact]
        public void Xlsx_written_by_XlsxWriter_reads_back()
        {
            string path = Path.Combine(Path.GetTempPath(), "assetctrl-test-" + Php.RandomToken(6) + ".xlsx");
            try
            {
                var w = new XlsxWriter(new[] { "Asset No", "Work Center", "Note" });
                w.AddRow(new object[] { "DEMO-PC-001", "D100·DEMO-A", "เครื่องสำรอง" });
                w.AddRow(new object[] { "DEMO-PC-002", "", 42 });
                w.Save(path);

                var rows = SpreadsheetReader.Read(path, "export.xlsx");
                Assert.Equal(3, rows.Count);
                Assert.Equal(new[] { "Asset No", "Work Center", "Note" }, rows[0]);
                Assert.Equal(new[] { "DEMO-PC-001", "D100·DEMO-A", "เครื่องสำรอง" }, rows[1]);
                Assert.Equal("DEMO-PC-002", rows[2][0]);
                Assert.Equal("42", rows[2][2]);
            }
            finally
            {
                if (File.Exists(path)) File.Delete(path);
            }
        }

        [Fact]
        public void Csv_with_bom_quotes_and_thai_reads_back()
        {
            string path = Path.Combine(Path.GetTempPath(), "assetctrl-test-" + Php.RandomToken(6) + ".csv");
            try
            {
                File.WriteAllText(path, "Asset No,Note\r\nDEMO-PC-001,\"ห้อง A, ชั้น 2\"\r\n", new UTF8Encoding(true));
                var rows = SpreadsheetReader.Read(path, "list.csv");
                Assert.Equal("Asset No", rows[0][0]);
                Assert.Equal("ห้อง A, ชั้น 2", rows[1][1]);
            }
            finally
            {
                if (File.Exists(path)) File.Delete(path);
            }
        }

        [Fact]
        public void Other_file_types_are_refused()
        {
            Assert.Throws<ValidationException>(() => SpreadsheetReader.Read("x.pdf", "x.pdf"));
        }

        [Theory]
        [InlineData(0, "A")]
        [InlineData(25, "Z")]
        [InlineData(26, "AA")]
        [InlineData(701, "ZZ")]
        public void Column_names(int index, string expected)
        {
            Assert.Equal(expected, XlsxWriter.ColName(index));
        }
    }
}
