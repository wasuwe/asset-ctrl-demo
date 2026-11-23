using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using AssetCtrl.Core;
using AssetCtrl.Models;
using AssetCtrl.Repositories;

namespace AssetCtrl.Api.Controllers
{
    /// <summary>
    /// User accounts (admin, users.manage). Users are granted Work Centers directly
    /// (user_work_centers). Dept fields are not read or written here.
    /// </summary>
    public class UserController : ApiController
    {
        public override void Before()
        {
            RequireAdmin();
            RequireAbility("users.manage");
        }

        private UserRepository Repo()
        {
            return new UserRepository(Db);
        }

        /// <summary>GET admin/users?q=&amp;role=&amp;wc=&amp;active=&amp;page= -> { rows, pager, work_centers, filters }</summary>
        public void Index()
        {
            var f = new Row
            {
                { "q", Request.Query("q", "") },
                { "role", Request.Query("role", "") },
                { "wc", Request.Query("wc", "") },
                { "active", Request.Query("active", "1") },
            };
            var search = f.Copy();
            if (f.Str("active") != "0" && f.Str("active") != "1")
            {
                search["active"] = ""; // 'all'
            }
            var result = Repo().Search(search, Request.Int("page", 1));
            var o = Paged((List<Row>)result["rows"], (Paginator)result["pager"]);
            o["filters"] = f;
            o["work_centers"] = new WorkCenterRepository(Db).All();
            Respond(o);
        }

        /// <summary>GET admin/users/form?id= -> { user|null, work_center_ids, work_centers } (data for the create/edit modal)</summary>
        public void Form()
        {
            int id = Request.Int("id");
            Row user = null;
            if (id != 0)
            {
                var row = Repo().Find(id);
                if (row == null)
                {
                    NotFound("User not found.");
                }
                user = UserRepository.Shape(row);
            }
            Respond(new Row
            {
                { "user", user },
                { "work_center_ids", id != 0 ? Repo().WorkCenters(id) : new List<int>() },
                { "work_centers", new WorkCenterRepository(Db).All() },
            });
        }

        private static readonly Regex EmpCodeRe = new Regex(@"^[A-Z0-9_\-\.]{2,32}$");

        /// <summary>
        /// Close to PHP FILTER_VALIDATE_EMAIL: dot-atom local part, dotted host name labels.
        /// </summary>
        private static readonly Regex EmailRe = new Regex(
            @"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$");

        /// <summary>POST admin/users/save { id?, emp_code, first_name, last_name, email, phone, role, can_repair, is_active, work_centers[], password (new only) }</summary>
        public void Save()
        {
            var repo = Repo();
            int id = Request.Int("id");
            Row current = id != 0 ? repo.Find(id) : null;
            if (id != 0 && current == null)
            {
                NotFound("User not found.");
            }
            var r = Request;
            var errors = new List<string>();
            var data = new Row
            {
                { "emp_code", Php.CleanCode(r.Post("emp_code", "")) },
                { "first_name", Php.CleanText(r.Post("first_name", "")) },
                { "last_name", Php.CleanText(r.Post("last_name", "")) },
                { "email", Php.CleanText(r.Post("email", "")) },
                { "phone", Php.CleanText(r.Post("phone", "")) },
                { "role", r.Post("role", Role.User) },
                { "can_repair", r.Post("can_repair") == "1" ? 1 : 0 },
                { "is_active", r.Post("is_active") == "1" ? 1 : 0 },
            };
            if (!EmpCodeRe.IsMatch(data.Str("emp_code")))
            {
                errors.Add("The employee code may only use A-Z, 0-9, _ - . (2–32 characters).");
            }
            else
            {
                var dupe = repo.FindByEmpCode(data.Str("emp_code"));
                if (dupe != null && dupe.Int("id") != id)
                {
                    errors.Add("This employee code is already in use.");
                }
            }
            if (data.Str("first_name") == "")
            {
                errors.Add("Please enter a first name.");
            }
            if (data.Str("email") != "" && !EmailRe.IsMatch(data.Str("email")))
            {
                errors.Add("The email address is not valid.");
            }
            var roles = Role.Labels();
            if (!roles.ContainsKey(data.Str("role")))
            {
                errors.Add("The role is not valid.");
            }
            var wcIds = ValidWorkCenterIds(r.Arr("work_centers"));
            if (data.Str("role") == Role.User && wcIds.Count == 0)
            {
                errors.Add("Give the user at least one Work Center.");
            }
            if (data.Str("role") == Role.User)
            {
                data["can_repair"] = 0;
            }
            if (id != 0 && (data.Str("role") != Role.Admin || data.Int("is_active") == 0))
            {
                if (current.Str("role") == Role.Admin && repo.CountActiveAdmins(id) == 0)
                {
                    errors.Add("There must be at least one active admin.");
                }
            }
            string password = r.PostUntrimmed("password");
            if (id == 0 && System.Text.Encoding.UTF8.GetByteCount(password) < 8)
            {
                errors.Add("The initial password must be at least 8 characters.");
            }
            if (errors.Count > 0)
            {
                Fail(errors);
            }
            data["email"] = data.Str("email") != "" ? data["email"] : null;
            data["updated_at"] = Database.Now();

            long uid = Db.Transaction(() =>
            {
                long newId;
                if (id != 0)
                {
                    Db.Update("users", data, "id = :id", new Row { { "id", id } });
                    newId = id;
                }
                else
                {
                    data["password_hash"] = Passwords.Hash(password);
                    data["must_change_password"] = 1;
                    data["created_at"] = data["updated_at"];
                    newId = Db.Insert("users", data);
                }
                repo.SetWorkCenters(newId, data.Str("role") == Role.User ? wcIds : new List<int>());
                return newId;
            });
            Ok(
                id != 0 ? "Saved " + data.Str("emp_code") + "." : "Added " + data.Str("emp_code") + ".",
                new Row { { "id", (int)uid } }
            );
        }

        /// <summary>Keep only ids of existing Work Centers.</summary>
        private List<int> ValidWorkCenterIds(List<string> ids)
        {
            var clean = ids.Select(Php.ToInt).Where(x => x != 0).Distinct().ToList();
            if (clean.Count == 0)
            {
                return new List<int>();
            }
            var p = new Row();
            string inSql = Database.InClause("id", clean, p, "w");
            return Db.Column("SELECT id FROM work_centers WHERE " + inSql, p).Select(Php.ToInt).ToList();
        }

        /// <summary>POST admin/users/active { id, active: 1|0 } — activate / deactivate an account.</summary>
        public void SetActive()
        {
            var repo = Repo();
            var user = repo.Find(Request.Int("id"));
            if (user == null)
            {
                NotFound("User not found.");
            }
            int active = Request.Post("active") == "1" ? 1 : 0;
            if (active == 0)
            {
                if (user.Int("id") == (Auth.Id() ?? 0))
                {
                    Fail("You cannot deactivate your own account.");
                }
                if (user.Str("role") == Role.Admin && repo.CountActiveAdmins(user.Int("id")) == 0)
                {
                    Fail("There must be at least one active admin.");
                }
            }
            Db.Update("users", new Row { { "is_active", active }, { "updated_at", Database.Now() } }, "id = :id", new Row { { "id", user.Int("id") } });
            Ok((active != 0 ? "Activated " : "Deactivated ") + user.Str("emp_code") + ".");
        }

        /// <summary>POST admin/users/reset-password { id } -> { temp_password } (shown once)</summary>
        public void ResetPassword()
        {
            int id = Request.Int("id");
            var user = Repo().Find(id);
            if (user == null)
            {
                NotFound("User not found.");
            }
            // PHP: substr(strtr(base64_encode(9 random bytes), '+/=', 'xyz'), 0, 10)
            var bytes = new byte[9];
            using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create())
            {
                rng.GetBytes(bytes);
            }
            string temp = Convert.ToBase64String(bytes).Replace('+', 'x').Replace('/', 'y').Replace('=', 'z').Substring(0, 10);
            Db.Update("users", new Row
            {
                { "password_hash", Passwords.Hash(temp) },
                { "must_change_password", 1 },
                { "failed_logins", 0 },
                { "locked_until", null },
                { "updated_at", Database.Now() },
            }, "id = :id", new Row { { "id", id } });
            Ok("Password reset for " + user.Str("emp_code") + ".", new Row
            {
                { "temp_password", temp },
                { "emp_code", user.Get("emp_code") },
                { "name", (user.Str("first_name") + " " + user.Str("last_name")).Trim() },
            });
        }
    }
}
