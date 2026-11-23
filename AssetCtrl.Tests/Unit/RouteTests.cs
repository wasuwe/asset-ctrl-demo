using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using AssetCtrl.Api;
using Xunit;

namespace AssetCtrl.Tests.Unit
{
    /// <summary>Every API route must reach a real controller action (otherwise the kernel answers 501).</summary>
    public class RouteTests
    {
        private static readonly Router Table = Routes.Build();

        public static IEnumerable<object[]> AllRoutes()
        {
            return Table.All().Select(r => new object[] { r.Key, r.Value.Key, r.Value.Value });
        }

        [Theory]
        [MemberData(nameof(AllRoutes))]
        public void Route_has_a_controller_action(string route, string controller, string action)
        {
            var type = typeof(Kernel).Assembly.GetType("AssetCtrl.Api.Controllers." + controller);
            Assert.True(type != null, route + ": controller " + controller + " not found");
            string methodName = char.ToUpperInvariant(action[0]) + action.Substring(1);
            var method = type.GetMethod(methodName, BindingFlags.Public | BindingFlags.Instance, null, System.Type.EmptyTypes, null);
            Assert.True(method != null, route + ": " + controller + "." + methodName + "() not found");
        }

        [Fact]
        public void Head_falls_back_to_get()
        {
            Assert.Equal(Table.Match("session", "GET"), Table.Match("session", "HEAD"));
        }

        [Fact]
        public void Unknown_route_or_wrong_method_is_null()
        {
            Assert.Null(Table.Match("no/such/route", "GET"));
            Assert.Null(Table.Match("login", "GET"));
        }

        [Fact]
        public void Chunked_upload_route_exists()
        {
            Assert.NotNull(Table.Match("admin/import/upload-chunk", "POST"));
        }
    }
}
