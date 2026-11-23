namespace AssetCtrl.Core
{
    public class Csrf
    {
        private readonly Session _session;

        public Csrf(Session session)
        {
            _session = session;
        }

        public string Token()
        {
            string token = Php.ToStr(_session.Get("_csrf"));
            if (token == "")
            {
                token = Php.RandomToken(32);
                _session.Set("_csrf", token);
            }
            return token;
        }

        public bool Validate(string token)
        {
            string expected = Php.ToStr(_session.Get("_csrf"));
            return !string.IsNullOrEmpty(token) && expected != "" && Php.HashEquals(expected, token);
        }
    }
}
