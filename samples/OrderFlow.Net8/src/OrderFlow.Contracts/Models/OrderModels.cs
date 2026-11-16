namespace OrderFlow.Contracts.Models;

public sealed record OrderDto(
    Guid Id,
    Guid CustomerId,
    string Currency,
    decimal Subtotal,
    decimal DiscountAmount,
    decimal TotalAmount,
    string Status,
    DateTime CreatedAtUtc
);

public sealed record CreateOrderRequest(
    Guid CustomerId,
    string Currency,
    List<OrderLineItemDto> Items,
    string? PromoCode
);

public sealed record OrderLineItemDto(
    string Sku,
    int Quantity,
    decimal UnitPrice
);

public sealed record CustomerDto(
    Guid Id,
    string Email,
    string Tier,
    bool IsActive,
    decimal CreditLimit
);
