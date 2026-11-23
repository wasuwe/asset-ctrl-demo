using System;

namespace AssetCtrl.Core
{
    public class Paginator
    {
        public int Total;
        public int PerPage;
        public int Page;
        public int Pages;

        public Paginator(long total, int perPage, int page)
        {
            Total = (int)total;
            PerPage = Math.Max(1, perPage);
            Pages = Math.Max(1, (int)Math.Ceiling(Total / (double)PerPage));
            Page = Math.Min(Math.Max(1, page), Pages);
        }

        public int Offset()
        {
            return (Page - 1) * PerPage;
        }

        public int From()
        {
            return Total > 0 ? Offset() + 1 : 0;
        }

        public int To()
        {
            return Math.Min(Total, Offset() + PerPage);
        }
    }
}
