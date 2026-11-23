using System;
using System.Collections.Generic;
using System.Linq;

namespace AssetCtrl.Core
{
    /// <summary>HTTP error with a status code (PHP HttpException).</summary>
    public class HttpException : Exception
    {
        public int Status { get; private set; }

        public HttpException(int status, string message) : base(message)
        {
            Status = status;
        }
    }

    /// <summary>API error: HTTP status + machine-readable code (auth, csrf, forbidden, not_found ...).</summary>
    public class ApiException : HttpException
    {
        public string Code { get; private set; }

        public ApiException(int status, string message, string code = null) : base(status, message)
        {
            Code = code;
        }
    }

    /// <summary>Validation problems -> 422 { ok: false, errors: [...] }.</summary>
    public class ValidationException : Exception
    {
        public List<string> Errors { get; private set; }

        public ValidationException(IEnumerable<string> errors) : base(string.Join(" ", errors))
        {
            Errors = errors.ToList();
        }

        public ValidationException(string error) : this(new[] { error }) { }
    }

    /// <summary>
    /// The database cannot be reached (connection failed). The API turns this into
    /// 503 { code: "db_unavailable" } and the browser app then runs in Demo mode with
    /// built-in sample data (appSetting DemoFallback).
    /// </summary>
    public class DatabaseUnavailableException : Exception
    {
        public DatabaseUnavailableException(string message, Exception inner = null) : base(message, inner)
        {
        }
    }

    /// <summary>
    /// Thrown after a controller has written its JSON response (PHP's "echo ...; exit;").
    /// The handler catches it and ends the request normally.
    /// </summary>
    public class ResponseSentException : Exception
    {
    }
}
