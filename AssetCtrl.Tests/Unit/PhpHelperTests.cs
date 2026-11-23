using AssetCtrl.Core;
using Xunit;

namespace AssetCtrl.Tests.Unit
{
    /// <summary>The Php helpers must behave like the PHP functions they replace.</summary>
    public class PhpHelperTests
    {
        [Theory]
        [InlineData("  PC   Desktop \t 01 ", "PC Desktop 01")]
        [InlineData(null, "")]
        [InlineData("", "")]
        public void CleanText_trims_and_collapses_spaces(string input, string expected)
        {
            Assert.Equal(expected, Php.CleanText(input));
        }

        [Fact]
        public void CleanCode_upper_cases()
        {
            Assert.Equal("D100 DEMO-A", Php.CleanCode(" d100   demo-a "));
        }

        [Theory]
        [InlineData("12abc", 12)]
        [InlineData("-7", -7)]
        [InlineData("abc", 0)]
        [InlineData("3.9", 3)]
        [InlineData(null, 0)]
        public void ToInt_reads_leading_number_like_php_int_cast(string input, int expected)
        {
            Assert.Equal(expected, Php.ToInt(input));
        }

        [Theory]
        [InlineData("10", true)]
        [InlineData(" 2.5 ", true)]
        [InlineData("1e3", true)]
        [InlineData("", false)]
        [InlineData("12a", false)]
        public void IsNumeric(string input, bool expected)
        {
            Assert.Equal(expected, Php.IsNumeric(input));
        }

        [Theory]
        [InlineData("", true)]
        [InlineData("0", true)]
        [InlineData("a", false)]
        public void IsEmpty_like_php_empty(string input, bool expected)
        {
            Assert.Equal(expected, Php.IsEmpty(input));
        }

        [Fact]
        public void MbLen_counts_each_thai_character()
        {
            Assert.Equal(7, Php.MbLen("เครื่อง"));
            Assert.Equal(0, Php.MbLen(null));
        }

        [Fact]
        public void MbLeft_cuts_by_characters()
        {
            Assert.Equal("เคร", Php.MbLeft("เครื่อง", 3));
            Assert.Equal("ab", Php.MbLeft("ab", 10));
        }

        [Fact]
        public void NumberFormat_uses_thousand_commas()
        {
            Assert.Equal("1,234,567", Php.NumberFormat(1234567));
        }

        [Fact]
        public void HashEquals()
        {
            Assert.True(Php.HashEquals("abc", "abc"));
            Assert.False(Php.HashEquals("abc", "abd"));
            Assert.False(Php.HashEquals("abc", null));
        }

        [Fact]
        public void RandomToken_is_hex_of_requested_length()
        {
            string t = Php.RandomToken(16);
            Assert.Equal(32, t.Length);
            Assert.Matches("^[0-9a-f]+$", t);
        }
    }
}
