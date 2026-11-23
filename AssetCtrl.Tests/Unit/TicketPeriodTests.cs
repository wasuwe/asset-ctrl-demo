using System;
using AssetCtrl.Api.Controllers;
using AssetCtrl.Core;
using Xunit;

namespace AssetCtrl.Tests.Unit
{
    /// <summary>Reported-date filter of the admin ticket list (period presets and custom range).</summary>
    public class TicketPeriodTests
    {
        private static string Day(int offset)
        {
            return Database.NowDate().Date.AddDays(offset).ToString("yyyy-MM-dd", Php.Inv);
        }

        [Theory]
        [InlineData("today", 0, 0)]
        [InlineData("yesterday", -1, -1)]
        [InlineData("7d", -6, 0)]
        [InlineData("30d", -29, 0)]
        public void Presets_count_back_from_today(string period, int from, int to)
        {
            var r = TicketController.Period(period, "", "");
            Assert.Equal(period, r.Str("period"));
            Assert.Equal(Day(from), r.Str("from"));
            Assert.Equal(Day(to), r.Str("to"));
        }

        [Fact]
        public void Month_starts_on_the_first()
        {
            var r = TicketController.Period("month", "", "");
            Assert.EndsWith("-01", r.Str("from"));
            Assert.Equal(Day(0), r.Str("to"));
        }

        [Fact]
        public void Custom_range_is_swapped_when_reversed()
        {
            var r = TicketController.Period("custom", "2026-11-16", "2026-11-01");
            Assert.Equal("2026-11-01", r.Str("from"));
            Assert.Equal("2026-11-16", r.Str("to"));
        }

        [Theory]
        [InlineData("2026-13-40")]
        [InlineData("16/11/2026")]
        [InlineData("x' OR 1=1")]
        public void Custom_range_drops_bad_dates(string bad)
        {
            var r = TicketController.Period("custom", bad, "2026-11-16");
            Assert.Equal("", r.Str("from"));
            Assert.Equal("2026-11-16", r.Str("to"));
        }

        [Theory]
        [InlineData("")]
        [InlineData("forever")]
        public void Unknown_period_means_any_time(string period)
        {
            var r = TicketController.Period(period, "2026-11-01", "2026-11-16");
            Assert.Equal("", r.Str("period"));
            Assert.Equal("", r.Str("from"));
            Assert.Equal("", r.Str("to"));
        }
    }
}
