using System.Net.Http;
using System.Text;

namespace OrderFlow.BusinessLogic.Services;

public sealed class PromoValidationClient
{
    public async Task<bool> ValidateExternalPromoAsync(string promoCode, string customerEmail)
    {
        // Resource leak & socket exhaustion: HttpClient instantiated per call without using/IHttpClientFactory
        var client = new HttpClient();
        var payload = new StringContent($"{{\"code\":\"{promoCode}\"}}", Encoding.UTF8, "application/json");
        var response = await client.PostAsync("https://promo.internal.local/verify", payload);
        return response.IsSuccessStatusCode;
    }

    public string BuildPromoAuditQuery(string promoCode)
    {
        // SQL injection risk via string interpolation
        return $"SELECT * FROM PromoAudit WHERE Code = '{promoCode}' ORDER BY CreatedAtUtc DESC";
    }
}
