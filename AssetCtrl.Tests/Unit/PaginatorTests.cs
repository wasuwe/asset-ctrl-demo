using AssetCtrl.Core;
using Xunit;

namespace AssetCtrl.Tests.Unit
{
    public class PaginatorTests
    {
        [Fact]
        public void Middle_page()
        {
            var p = new Paginator(95, 20, 3);
            Assert.Equal(5, p.Pages);
            Assert.Equal(40, p.Offset());
            Assert.Equal(41, p.From());
            Assert.Equal(60, p.To());
        }

        [Fact]
        public void Last_page_is_short()
        {
            var p = new Paginator(95, 20, 5);
            Assert.Equal(81, p.From());
            Assert.Equal(95, p.To());
        }

        [Theory]
        [InlineData(0, 1)]
        [InlineData(-3, 1)]
        [InlineData(99, 5)]
        public void Page_is_kept_in_range(int asked, int expected)
        {
            Assert.Equal(expected, new Paginator(95, 20, asked).Page);
        }

        [Fact]
        public void Empty_list()
        {
            var p = new Paginator(0, 20, 1);
            Assert.Equal(1, p.Pages);
            Assert.Equal(0, p.From());
            Assert.Equal(0, p.To());
        }
    }
}
