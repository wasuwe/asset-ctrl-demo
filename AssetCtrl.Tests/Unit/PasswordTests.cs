using AssetCtrl.Core;
using Xunit;

namespace AssetCtrl.Tests.Unit
{
    /// <summary>Passwords must stay compatible with PHP password_hash()/password_verify().</summary>
    public class PasswordTests
    {
        [Fact]
        public void Hash_uses_php_prefix_and_cost_10()
        {
            string hash = Passwords.Hash("demo-pass-123");
            Assert.StartsWith("$2y$10$", hash);
            Assert.Equal(60, hash.Length);
        }

        [Fact]
        public void Verify_accepts_right_password_only()
        {
            string hash = Passwords.Hash("demo-pass-123");
            Assert.True(Passwords.Verify("demo-pass-123", hash));
            Assert.False(Passwords.Verify("wrong", hash));
        }

        [Fact]
        public void Verify_accepts_2a_and_2y_forms_of_the_same_hash()
        {
            string hash = Passwords.Hash("demo-pass-123");
            Assert.True(Passwords.Verify("demo-pass-123", hash.Replace("$2y$", "$2a$")));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("not-a-hash")]
        public void Verify_is_false_for_missing_or_broken_hash(string hash)
        {
            Assert.False(Passwords.Verify("x", hash));
        }

        [Fact]
        public void NeedsRehash()
        {
            Assert.False(Passwords.NeedsRehash(Passwords.Hash("x")));
            Assert.True(Passwords.NeedsRehash("$2y$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234"));
            Assert.True(Passwords.NeedsRehash(""));
        }
    }
}
