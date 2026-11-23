using System.Collections.Generic;
using System.Text.RegularExpressions;
using AssetCtrl.Core;
using AssetCtrl.Repositories;

namespace AssetCtrl.Api.Controllers
{
    /// <summary>Who am I, sign in / out, change password, own contact details, menu badge counts.</summary>
    public class SessionController : ApiController
    {
        public override void Before()
        {
            // session and login are public; the rest check inside the action.
        }

        /// <summary>GET session -> { user|null, csrf, meta }</summary>
        public void Show()
        {
            // Touch the database first, so the app learns at start-up when it is not available
            // (Kernel answers 503 db_unavailable and the browser switches to Demo mode).
            Db.Value("SELECT 1");
            Respond(new Row
            {
                { "user", Meta.User(App) },
                { "csrf", App.Csrf.Token() },
                { "meta", Meta.Build() },
            });
        }

        /// <summary>POST login { emp_code, password } -> { user, csrf }</summary>
        public void Login()
        {
            var result = Auth.Attempt(Request.Post("emp_code"), Request.PostUntrimmed("password"));
            if (!result.Ok)
            {
                Fail(result.Message, 401);
            }
            App.Session.Forget("_csrf"); // new token for the new session
            Ok("Signed in", new Row { { "user", Meta.User(App) }, { "csrf", App.Csrf.Token() } });
        }

        /// <summary>POST logout -> { csrf }</summary>
        public void Logout()
        {
            Auth.Logout();
            Ok("Signed out", new Row { { "csrf", App.Csrf.Token() } });
        }

        /// <summary>POST account/password { current_password, password, password_confirm }</summary>
        public void ChangePassword()
        {
            RequireLogin();
            var user = Auth.User();
            string current = Request.PostUntrimmed("current_password");
            string next = Request.PostUntrimmed("password");
            string confirm = Request.PostUntrimmed("password_confirm");

            if (!Passwords.Verify(current, user.Str("password_hash")))
            {
                Fail("Current password is incorrect.");
            }
            else if (System.Text.Encoding.UTF8.GetByteCount(next) < 8)
            {
                Fail("The new password must be at least 8 characters.");
            }
            else if (next != confirm)
            {
                Fail("The password confirmation does not match.");
            }
            else if (next == current)
            {
                Fail("The new password must be different from the current one.");
            }
            else if (string.Equals(next, user.Str("emp_code"), System.StringComparison.OrdinalIgnoreCase))
            {
                Fail("Do not use your employee code as the password.");
            }
            Db.Update("users", new Row
            {
                { "password_hash", Passwords.Hash(next) },
                { "must_change_password", 0 },
                { "updated_at", Database.Now() },
            }, "id = :id", new Row { { "id", user.Int("id") } });
            App.Session.Regenerate();
            Auth.Refresh();
            Ok("Password changed", new Row { { "user", Meta.User(App) } });
        }

        private static readonly Regex EmailRe = new Regex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$");

        /// <summary>POST account/profile { email, phone }: anyone signed in may edit their own contact details.</summary>
        public void UpdateProfile()
        {
            RequireLogin();
            var user = Auth.User();
            string email = Php.CleanText(Request.Post("email"));
            string phone = Php.CleanText(Request.Post("phone"));
            var errors = new List<string>();
            if (email != "" && (email.Length > 191 || !EmailRe.IsMatch(email)))
            {
                errors.Add("The email address is not valid.");
            }
            if (Php.MbLen(phone) > 32)
            {
                errors.Add("The phone number may be at most 32 characters.");
            }
            if (errors.Count > 0)
            {
                Fail(errors);
            }
            Db.Update("users", new Row
            {
                { "email", email != "" ? email : null },
                { "phone", phone != "" ? phone : null },
                { "updated_at", Database.Now() },
            }, "id = :id", new Row { { "id", user.Int("id") } });
            Auth.Refresh();
            Ok("Contact details saved", new Row { { "user", Meta.User(App) } });
        }

        /// <summary>GET nav-counts -> { tickets }: unassigned tickets (admin); users get no badge.</summary>
        public void NavCounts()
        {
            RequireLogin();
            var counts = new TicketRepository(Db).ViewCounts(Auth);
            Respond(new Row { { "tickets", Auth.IsAdmin() ? counts.Int("unassigned") : 0 } });
        }
    }
}
